"""Bounded live acceptance with synthetic source only; no customer credentials.

Creates two disposable test accounts only with --allow-create-test-accounts.
Deletes its own snapshots and logs out in finally. Never sends a coding prompt
to Anthropic or executes imported source. Reports contain no passwords/tokens.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import secrets
import time
from urllib.parse import parse_qs, urlsplit

import requests


FILES = [
    {'path': 'app.py', 'content': 'from permissions import may_schedule\n\ndef schedule_interview(user, candidate):\n    if not may_schedule(user):\n        raise PermissionError("forbidden")\n    return {"candidate": candidate, "status": "scheduled"}\n'},
    {'path': 'permissions.py', 'content': 'def may_schedule(user):\n    return user.get("role") == "recruiter"\n'},
    {'path': 'requirements.txt', 'content': 'pytest==9.1.1\n'},
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--api', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--allow-create-test-accounts', action='store_true')
    args = parser.parse_args()
    base = args.api.rstrip('/')
    origin = urlsplit(base)
    if origin.scheme != 'https' or origin.path or origin.query or origin.username or origin.fragment:
        parser.error('Use a public HTTPS API origin.')
    if not args.allow_create_test_accounts:
        parser.error('This acceptance test creates two accounts; pass --allow-create-test-accounts to opt in.')
    report = {'started_at': datetime.now(timezone.utc).isoformat(), 'api': base,
              'scope': 'Synthetic, bounded API acceptance; not a browser, restore or load test.',
              'checks': [], 'test_accounts': [], 'snapshots_deleted': [], 'errors': []}
    accounts, snapshots = [], []

    def check(name, passed, **evidence):
        report['checks'].append({'name': name, 'passed': bool(passed), **evidence})
        print(f'{name}: {"PASS" if passed else "FAIL"}', flush=True)

    def call(method, path, account=None, data=None):
        headers = {'Accept': 'application/json'}
        if account:
            headers['Authorization'] = 'Token ' + account['token']
        start = time.monotonic()
        response = requests.request(method, base + path, headers=headers, json=data, timeout=90, allow_redirects=False)
        response.elapsed_seconds = round(time.monotonic() - start, 3)
        return response

    def prepare(account, snapshot, values):
        response = call('POST', f'/api/ingestion/{snapshot}/prepare/', account, values)
        check('prepare_admitted', response.status_code == 202, status=response.status_code, seconds=response.elapsed_seconds)
        if response.status_code != 202:
            return None
        preparation = response.json()['preparation_id']
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            response = call('GET', f'/api/ingestion/{snapshot}/prepare/{preparation}/', account)
            if response.status_code != 200:
                check('prepare_poll', False, status=response.status_code)
                return None
            job = response.json()
            if job['status'] == 'succeeded':
                check('prepare_completed', True)
                return job
            if job['status'] == 'failed':
                check('prepare_completed', False, job_status='failed')
                return None
            time.sleep(2)
        check('prepare_completed', False, reason='180 second acceptance deadline')
        return None

    try:
        suffix = datetime.now(timezone.utc).strftime('%Y%m%d') + '_' + secrets.token_hex(4)
        for index in range(2):
            username = f'launchcheck_{suffix}_{index}'
            password = secrets.token_urlsafe(32)
            response = call('POST', '/api/auth/register/', data={'username': username, 'email': username + '@example.invalid', 'password': password})
            check('register', response.status_code == 201, status=response.status_code, seconds=response.elapsed_seconds)
            if response.status_code != 201:
                raise RuntimeError('Registration failed; dependent acceptance checks cannot run.')
            account = {'token': response.json()['token'], 'username': username}
            accounts.append(account)
            report['test_accounts'].append(username)
            response = call('GET', '/api/auth/me/', account)
            check('profile', response.status_code == 200)
            response = call('POST', '/api/auth/logout/', account)
            check('logout', response.status_code == 204)
            response = call('GET', '/api/auth/me/', account)
            check('revoked_token_rejected', response.status_code == 401)
            response = call('POST', '/api/auth/login/', data={'username': username, 'password': password})
            check('login', response.status_code == 200, seconds=response.elapsed_seconds)
            if response.status_code != 200:
                raise RuntimeError('Login failed.')
            account['token'] = response.json()['token']
        owner, other = accounts
        response = call('POST', '/api/ingestion/import/', owner, {'project_name': 'Launch acceptance (synthetic)', 'files': FILES})
        check('folder_import', response.status_code == 201, status=response.status_code, seconds=response.elapsed_seconds)
        if response.status_code != 201:
            raise RuntimeError('Folder import failed.')
        snapshot = response.json()['id']
        snapshots.append((owner, snapshot))
        response = call('GET', f'/api/ingestion/{snapshot}/', owner)
        check('snapshot_read', response.status_code == 200)
        check('private_snapshot_no_store', 'no-store' in response.headers.get('Cache-Control', ''), cache_control=response.headers.get('Cache-Control', 'missing'))
        response = call('GET', '/api/ingestion/', owner)
        check('library', response.status_code == 200)
        for method, path, data in [
            ('GET', f'/api/ingestion/{snapshot}/', None),
            ('DELETE', f'/api/ingestion/{snapshot}/', None),
            ('POST', f'/api/ingestion/{snapshot}/prepare/', {'task': 'Schedule interviews'}),
            ('GET', f'/api/ingestion/{snapshot}/handoffs/', None),
        ]:
            response = call(method, path, other, data)
            check('cross_owner_' + method.lower() + '_' + path.rstrip('/').split('/')[-1], response.status_code == 404, status=response.status_code)
        response = call('POST', '/api/ingestion/import/', owner, {'project_name': 'Rejected secret file', 'files': [{'path': '.env', 'content': 'EXAMPLE_ONLY=not-a-secret'}]})
        check('credential_file_rejected', response.status_code == 400)
        values = {'task': 'Improve schedule_interview validation', 'acceptance': 'Only recruiters may schedule interviews', 'max_tokens': 4000, 'retrieval_mode': 'fast'}
        prepared = prepare(owner, snapshot, values)
        if prepared:
            output = prepared['output']
            handoff = output.get('handoff', {})
            check('handoff_has_task_and_source', handoff.get('request', {}).get('task') == values['task'] and bool(handoff.get('code')))
            check('handoff_progress_instruction', 'Make useful progress now' in handoff.get('instruction', ''))
            response = call('POST', f'/api/ingestion/{snapshot}/handoffs/', owner, {**prepared['request'], 'preparation_id': prepared['preparation_id']})
            check('save_prepared_handoff', response.status_code == 201, status=response.status_code)
            if response.status_code == 201:
                saved = response.json()
                response = call('GET', f'/api/ingestion/{snapshot}/handoffs/{saved["id"]}/', owner)
                check('restore_saved_handoff_exactly', response.status_code == 200 and response.json().get('output') == output)
            follow = prepare(owner, snapshot, {**values, 'follow_up': 'Keep may_schedule from permissions.py when changing validation.'})
            check('follow_up_preserves_original_task', bool(follow) and follow['output']['handoff']['request']['task'] == values['task'])
            response = call('POST', f'/api/ingestion/{snapshot}/claude-launch/', owner, {'handoff': handoff})
            check('claude_launch_created', response.status_code == 201, status=response.status_code)
            if response.status_code == 201:
                launch = response.json()
                query = parse_qs(urlsplit(launch['url']).query)
                prompt_url = query.get('prompt_url', [''])[0]
                if urlsplit(prompt_url).netloc != origin.netloc:
                    check('claude_prompt_origin', False)
                else:
                    prompt = requests.get(prompt_url, timeout=45, headers={'Origin': 'https://claude.ai'})
                    try:
                        exact = prompt.json() == handoff
                    except ValueError:
                        exact = False
                    check('claude_full_handoff_prefill', prompt.status_code == 200 and exact, status=prompt.status_code)
                    check('claude_prompt_cors', prompt.headers.get('Access-Control-Allow-Origin') == 'https://claude.ai')
                    response = call('DELETE', f'/api/ingestion/{snapshot}/claude-launch/{launch["id"]}/', owner)
                    check('claude_link_revocation', response.status_code == 204 and requests.get(prompt_url, timeout=45).status_code == 404)
            # Two small synthetic preparations, not a stress test of a shared host.
            with ThreadPoolExecutor(max_workers=2) as pool:
                responses = list(pool.map(lambda _: call('POST', f'/api/ingestion/{snapshot}/prepare/', owner, values), range(2)))
            check('two_bounded_concurrent_preparations_admitted', all(response.status_code == 202 for response in responses), statuses=[response.status_code for response in responses])
            for response in responses:
                if response.status_code == 202:
                    job_id = response.json()['preparation_id']
                    deadline = time.monotonic() + 180
                    while time.monotonic() < deadline:
                        poll = call('GET', f'/api/ingestion/{snapshot}/prepare/{job_id}/', owner)
                        job = poll.json()
                        if job.get('status') in ('succeeded', 'failed'):
                            check('concurrent_preparation_completed', job['status'] == 'succeeded')
                            break
                        time.sleep(2)
                    else:
                        check('concurrent_preparation_completed', False, reason='deadline')
    except Exception as error:
        # Exception types only: requests errors can include capability URLs.
        report['errors'].append(type(error).__name__)
        check('acceptance_runner_completed', False, error_type=type(error).__name__)
    finally:
        for account, snapshot in snapshots:
            try:
                response = call('DELETE', f'/api/ingestion/{snapshot}/', account)
                check('synthetic_snapshot_cleanup', response.status_code in (204, 404))
                if response.status_code in (204, 404):
                    report['snapshots_deleted'].append(snapshot)
            except Exception:
                check('synthetic_snapshot_cleanup', False)
        for account in accounts:
            try:
                check('final_logout', call('POST', '/api/auth/logout/', account).status_code == 204)
            except Exception:
                check('final_logout', False)
        report['finished_at'] = datetime.now(timezone.utc).isoformat()
        report['passed'] = bool(report['checks']) and all(item['passed'] for item in report['checks'])
        report['account_cleanup_note'] = 'Empty synthetic accounts remain; no account-deletion API exists. Tokens were revoked by logout. No credentials are retained.'
        Path(args.output).write_text(json.dumps(report, indent=2), encoding='utf-8')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
