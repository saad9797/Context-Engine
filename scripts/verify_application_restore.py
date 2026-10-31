"""Encrypted Django application-data backup and isolated restore drill.

Uses a local env file, never prints credentials. Creates ONE uniquely named
scratch database on the same Postgres host, restores there, validates row counts,
and drops only that database in finally. It never restores into the source DB.
This is an application recovery test, not a pg_dump/PITR verification.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
import re
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit, urlunsplit, quote

from cryptography.fernet import Fernet
from dotenv import dotenv_values
import psycopg2
from psycopg2 import sql

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / 'Rest Saas'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--env-file', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--backup-file', help='Reuse an existing encrypted application backup for a recovery drill.')
    parser.add_argument('--allow-create-restore-database', action='store_true')
    args = parser.parse_args()
    if not args.allow_create_restore_database:
        parser.error('Opt in with --allow-create-restore-database.')
    values = dotenv_values(args.env_file)
    source = values.get('DATABASE_URL', '')
    cipher = Fernet(values.get('FIELD_ENCRYPTION_KEY', '').encode())
    parsed = urlsplit(source)
    if parsed.scheme not in ('postgres', 'postgresql') or not parsed.hostname:
        parser.error('The selected env file must contain a PostgreSQL DATABASE_URL.')
    name = 'contexa_restorecheck_' + secrets.token_hex(8)
    if parsed.path.strip('/') == name:
        raise RuntimeError('Scratch database must differ from source.')
    target = urlunsplit((parsed.scheme, parsed.netloc, '/' + quote(name), parsed.query, ''))
    report = {'started_at': datetime.now(timezone.utc).isoformat(), 'scope': 'Django application fixture recovery; not full Postgres/PITR or scheduled/off-site backup proof.', 'checks': []}
    report['scratch_database'] = name
    env = {**os.environ, **{key: value for key, value in values.items() if value is not None}, 'DJANGO_SETTINGS_MODULE': 'core.production_settings', 'CONTEXA_SEMANTIC': '0', 'PYTHONIOENCODING': 'utf-8', 'PYTHONUTF8': '1'}
    python = sys.executable
    connection = None
    created = False

    def check(name, passed):
        report['checks'].append({'name': name, 'passed': bool(passed)})
        report['in_progress'] = True
        Path(args.output).write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(f'{name}: {"PASS" if passed else "FAIL"}', flush=True)

    def manage(*command, database=source, readonly=False):
        selected_env = {**env, 'DATABASE_URL': database}
        selected_env.pop('PGOPTIONS', None)
        if readonly:
            # Pooled Postgres may reject startup PGOPTIONS. Enforce a stable,
            # read-only snapshot inside a transaction instead.
            program = "import django,sys; django.setup(); from django.core.management import call_command; from django.db import transaction,connection\nwith transaction.atomic():\n connection.cursor().execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')\n call_command(*sys.argv[1:])\n"
            invocation = [python, '-c', program, *command]
        else:
            invocation = [python, 'manage.py', *command]
        try:
            result = subprocess.run(invocation, cwd=BACKEND, env=selected_env, capture_output=True, timeout=600)
        except subprocess.TimeoutExpired:
            report['failed_command'] = command[0]
            raise
        if result.returncode:
            report['failed_command'] = command[0]
            diagnostic = result.stderr.decode('utf-8', errors='replace')
            report['diagnostic_classes'] = [name for name in ['ImproperlyConfigured', 'OperationalError', 'ProgrammingError', 'PermissionDenied', 'CommandError', 'IntegrityError', 'ModuleNotFoundError', 'SerializationError'] if name in diagnostic]
            missing = re.search(r'(?:relation|column) "([A-Za-z0-9_]+)" does not exist', diagnostic)
            if missing:
                report['missing_database_object'] = missing.group(1)
            if 'read-only transaction' in diagnostic:
                report['read_only_transaction_error'] = True
            if 'ProgrammingError' in diagnostic:
                lines = [line for line in diagnostic.splitlines() if 'Unable to serialize database:' in line]
                if lines:
                    message = lines[-1]
                    for value in values.values():
                        if value and len(value) > 8:
                            message = message.replace(value, '[redacted]')
                    report['database_error_summary'] = message[:240]
            raise RuntimeError('A recovery management command failed; command output intentionally withheld to protect data.')
        return result.stdout

    try:
        # django_rq's dashboard is an unmanaged, permission-only model, not
        # a physical table. Redis queue state is deliberately outside this backup.
        report['excluded_virtual_app'] = 'django_rq (unmanaged dashboard; queue state is in Redis)'
        if args.backup_file:
            encrypted_path = Path(args.backup_file).resolve()
            encrypted_path.relative_to(ROOT)
            fixture = cipher.decrypt(encrypted_path.read_bytes())
            check('existing_encrypted_backup_loaded', True)
        else:
            fixture = manage('dumpdata', '--all', '--natural-foreign', '--exclude', 'django_rq', '--verbosity', '0', readonly=True)
        records = json.loads(fixture)
        expected = Counter(record['model'] for record in records)
        check('application_fixture_export', bool(records))
        backup_dir = ROOT / 'tmp/launch-backups'
        backup_dir.mkdir(parents=True, exist_ok=True)
        if not args.backup_file:
            encrypted_path = backup_dir / (name + '.json.fernet')
            encrypted_path.write_bytes(cipher.encrypt(fixture))
        report['encrypted_backup'] = str(encrypted_path.relative_to(ROOT))
        report['fixture_bytes'] = len(fixture)
        report['model_counts'] = dict(sorted(expected.items()))
        check('encrypted_backup_roundtrip', cipher.decrypt(encrypted_path.read_bytes()) == fixture)
        connection = psycopg2.connect(source, connect_timeout=15)
        connection.autocommit = True
        with connection.cursor() as cursor:
            cursor.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
        created = True
        check('isolated_restore_database_created', True)
        manage('migrate', '--noinput', database=target)
        with tempfile.TemporaryDirectory(prefix='contexa-restore-') as temporary:
            path = Path(temporary) / 'application.json'
            path.write_bytes(cipher.decrypt(encrypted_path.read_bytes()))
            manage('loaddata', str(path), '--verbosity', '0', database=target)
        check('fixture_restored_to_scratch_database', True)
        restored = json.loads(manage('dumpdata', '--all', '--natural-foreign', '--exclude', 'django_rq', '--verbosity', '0', database=target, readonly=True))
        actual = Counter(record['model'] for record in restored)
        check('all_application_model_counts_match', expected == actual)
        # Compare every record, not just counts, including private source JSON.
        canonical = lambda rows: sorted(json.dumps(row, sort_keys=True) for row in rows)
        check('all_application_records_match', canonical(records) == canonical(restored))
        manage('check', database=target)
        check('restored_application_system_check', True)
    except Exception as error:
        report['error_type'] = type(error).__name__
        check('recovery_drill_completed', False)
    finally:
        if created and connection:
            try:
                # Never drop a computed or supplied source name. Only our
                # generated scratch database, after checking it exists.
                if not name.startswith('contexa_restorecheck_') or name == parsed.path.strip('/'):
                    raise RuntimeError('Scratch cleanup guard failed.')
                with connection.cursor() as cursor:
                    cursor.execute('SELECT datname FROM pg_database WHERE datname = %s', (name,))
                    if cursor.fetchone() != (name,):
                        raise RuntimeError('Scratch database identity mismatch.')
                    # Transaction poolers can retain idle physical sessions
                    # after the restore client exits. Only this guarded,
                    # generated scratch database may have them terminated.
                    cursor.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
                check('scratch_database_removed', True)
            except Exception:
                check('scratch_database_removed', False)
        if connection:
            connection.close()
        report['finished_at'] = datetime.now(timezone.utc).isoformat()
        report['in_progress'] = False
        report['passed'] = bool(report['checks']) and all(check['passed'] for check in report['checks'])
        Path(args.output).write_text(json.dumps(report, indent=2), encoding='utf-8')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
