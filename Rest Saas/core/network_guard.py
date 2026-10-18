"""
SSRF egress guard.

postgres_url / mongo_url / storage endpoint hostnames come straight from
tenant input and get dialed from inside our own infrastructure. Without a
check here, a malicious or careless value pointed at 169.254.169.254 (cloud
metadata), 127.0.0.1, or an internal RFC1918 address makes OUR server the
one connecting to it. This resolves the hostname and rejects anything that
lands on a private/loopback/link-local/reserved/metadata address, unless the
host is explicitly trusted via SSRF_ALLOWED_HOSTS.

This is a pre-flight check run once before a job is enqueued. It does not
fully close a DNS-rebinding window (the hostname could re-resolve to a
different IP by the time the Node runner actually connects) — the Node-side
ssrf-guard.js re-checks immediately before each connection for that reason.
Closing the window completely would mean connecting by pinned IP with the
hostname only used for TLS SNI/verification, which is out of scope here.
"""

import ipaddress
import socket
from urllib.parse import urlparse

import dns.resolver
from django.conf import settings


class UnsafeHostError(ValueError):
    pass


def _is_unsafe_ip(ip_str: str) -> bool:
    ip = ipaddress.ip_address(ip_str)
    return ip.is_private or ip.is_multicast or ip.is_reserved or ip.is_unspecified


def assert_safe_host(host: str) -> None:
    """Raise UnsafeHostError if `host` resolves to a disallowed address."""
    if not host:
        return

    host = host.strip().strip("[]")  # strip IPv6 literal brackets if present

    if host.lower() in settings.SSRF_ALLOWED_HOSTS:
        return

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as e:
        raise UnsafeHostError(f"Could not resolve host '{host}': {e}") from e

    resolved_ips = {info[4][0] for info in infos}
    for ip_str in resolved_ips:
        if _is_unsafe_ip(ip_str):
            raise UnsafeHostError(
                f"Host '{host}' resolves to '{ip_str}', which is a private/"
                "internal/reserved address. Refusing to connect. If this is "
                "intentional (a trusted internal database), add it to "
                "SSRF_ALLOWED_HOSTS."
            )


def _resolve_srv_target_hosts(host: str) -> list:
    """
    `mongodb+srv://` hostnames (the standard MongoDB Atlas connection-string
    format) intentionally have no A/AAAA record of their own — only a
    `_mongodb._tcp.<host>` SRV record pointing at the real replica-set
    member hostnames, which is what the driver actually connects to. A plain
    getaddrinfo() on the bare srv hostname just fails to resolve (NXDOMAIN),
    which would otherwise make this guard reject every valid Atlas URI.
    """
    try:
        answers = dns.resolver.resolve(f"_mongodb._tcp.{host}", "SRV")
    except Exception as e:
        raise UnsafeHostError(f"Could not resolve SRV record for '{host}': {e}") from e
    return [str(a.target).rstrip(".") for a in answers]


def assert_safe_url(url: str) -> None:
    """Parse a connection-string-style URL and validate its hostname."""
    if not url:
        return
    parsed = urlparse(url)
    if not parsed.hostname:
        return

    if (parsed.scheme or "").lower() == "mongodb+srv":
        if parsed.hostname.lower() in settings.SSRF_ALLOWED_HOSTS:
            return
        for target in _resolve_srv_target_hosts(parsed.hostname):
            assert_safe_host(target)
        return

    assert_safe_host(parsed.hostname)


def assert_safe_config(*, postgres_url=None, mysql_url=None, mongo_url=None, storage_config=None) -> None:
    """Run the SSRF guard over every externally-supplied host in one job's config."""
    assert_safe_url(postgres_url)
    assert_safe_url(mysql_url)
    assert_safe_url(mongo_url)
    if storage_config:
        endpoint = storage_config.get("endpoint")
        if endpoint:
            assert_safe_url(endpoint)
        connection_string = storage_config.get("connection_string")
        if connection_string:
            # Azure connection strings carry the endpoint as a
            # "BlobEndpoint=...;" segment rather than a bare URL.
            for part in connection_string.split(";"):
                if "=" in part:
                    key, _, value = part.partition("=")
                    if key.strip().lower() in ("blobendpoint", "queueendpoint", "tableendpoint", "fileendpoint"):
                        assert_safe_url(value)
