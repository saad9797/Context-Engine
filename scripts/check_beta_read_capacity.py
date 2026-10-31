"""Ten lightweight authenticated reads using only an empty synthetic audit account.
Never a stress test, never customer identity, no credentials retained in reports.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import secrets
import statistics
import time

from dotenv import dotenv_values
import psycopg2
import requests


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--env-file', required=True)
    parser.add_argument('--acceptance-report', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    values = dotenv_values(args.env_file)
    acceptance = json.loads(Path(args.acceptance_report).read_text(encoding='utf-8'))
    username = acceptance['test_accounts'][0]
    if not re.fullmatch(r'launchcheck_\d{8}_[a-f0-9]{8}_[01]', username):
        raise RuntimeError('Only a generated launch-check account is eligible.')
    connection = psycopg2.connect(values['DATABASE_URL'], connect_timeout=15)
    connection.autocommit = True
    token = secrets.token_hex(20)
    user_id = None
    report = {'checked_at': datetime.now(timezone.utc).isoformat(), 'scope': 'Ten simultaneous profile reads, not ten simultaneous project imports or a stress test.'}
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT id FROM auth_user WHERE username=%s AND NOT is_staff AND NOT is_superuser', (username,))
            row = cursor.fetchone()
            if not row:
                raise RuntimeError('Synthetic account not found.')
            user_id = row[0]
            cursor.execute('SELECT COUNT(*) FROM ingestion_ingestioncontext WHERE user_id=%s', (user_id,))
            if cursor.fetchone()[0]:
                raise RuntimeError('The synthetic account must have no saved projects.')
            cursor.execute('SELECT COUNT(*) FROM authtoken_token WHERE user_id=%s', (user_id,))
            if cursor.fetchone()[0]:
                raise RuntimeError('The synthetic account already has an active session.')
            cursor.execute('INSERT INTO authtoken_token (key,created,user_id) VALUES (%s,NOW(),%s)', (token, user_id))
        def read(_):
            started = time.monotonic()
            try:
                response = requests.get(acceptance['api'] + '/api/auth/me/', headers={'Authorization': 'Token ' + token}, timeout=45)
                return {'status': response.status_code, 'seconds': round(time.monotonic() - started, 3)}
            except requests.RequestException:
                return {'status': 'network_error', 'seconds': round(time.monotonic() - started, 3)}
        with ThreadPoolExecutor(max_workers=10) as pool:
            results = list(pool.map(read, range(10)))
        report['requests'] = results
        report['median_seconds'] = statistics.median(item['seconds'] for item in results)
        report['max_seconds'] = max(item['seconds'] for item in results)
        report['passed'] = all(item['status'] == 200 for item in results)
    except Exception as error:
        report['passed'] = False
        report['error_type'] = type(error).__name__
    finally:
        with connection.cursor() as cursor:
            cursor.execute('DELETE FROM authtoken_token WHERE key=%s', (token,))
        connection.close()
        report['temporary_session_removed'] = True
        Path(args.output).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
