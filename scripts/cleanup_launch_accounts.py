"""Remove only empty, logged-out synthetic accounts from one acceptance report."""
import argparse
from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import re
import sys

from dotenv import dotenv_values


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--env-file', required=True)
    parser.add_argument('--acceptance-report', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--allow-delete-synthetic-accounts', action='store_true')
    args = parser.parse_args()
    if not args.allow_delete_synthetic_accounts:
        parser.error('Explicit cleanup opt-in is required.')
    values = dotenv_values(args.env_file)
    acceptance_path = Path(args.acceptance_report)
    acceptance = json.loads(acceptance_path.read_text(encoding='utf-8'))
    if values.get('BACKEND_BASE_URL', '').rstrip('/') != acceptance['api']:
        raise RuntimeError('Production config and acceptance API differ.')
    names = acceptance['test_accounts']
    if not 1 <= len(names) <= 2 or any(not re.fullmatch(r'launchcheck_\d{8}_[a-f0-9]{8}_[01]', name) for name in names):
        raise RuntimeError('Only the exact generated test cohort is eligible.')
    for key, value in values.items():
        if value is not None:
            os.environ[key] = value
    os.environ['DJANGO_SETTINGS_MODULE'] = 'core.production_settings'
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'Rest Saas'))
    import django
    django.setup()
    from django.contrib.auth.models import User
    from django.db import transaction
    from rest_framework.authtoken.models import Token
    from ingestion.models import IngestionContext, DataSourceConnection, IngestionJob
    start = datetime.fromisoformat(acceptance['started_at']) - timedelta(seconds=5)
    end = datetime.fromisoformat(acceptance['finished_at']) + timedelta(seconds=5)
    removed = []
    with transaction.atomic():
        for name in names:
            user = User.objects.select_for_update().filter(username=name).first()
            if not user:
                continue
            if user.is_staff or user.is_superuser or not start <= user.date_joined <= end:
                raise RuntimeError('Synthetic-account identity guard failed.')
            if Token.objects.filter(user=user).exists() or IngestionContext.objects.filter(user=user).exists() or DataSourceConnection.objects.filter(user=user).exists() or IngestionJob.objects.filter(user=user).exists():
                raise RuntimeError('Refusing to remove an active account or any account with project data.')
            user.delete()
            removed.append(name)
    report = {'passed': True, 'deleted_synthetic_accounts': removed, 'source_snapshot_data_deleted': False,
              'scope': 'Exact empty audit accounts only; staff, active sessions, projects and connections are guarded.'}
    Path(args.output).write_text(json.dumps(report, indent=2), encoding='utf-8')
    acceptance['account_cleanup_note'] = 'The exact empty synthetic accounts were deleted by the guarded operator cleanup. No credentials or test projects remain.'
    acceptance_path.write_text(json.dumps(acceptance, indent=2), encoding='utf-8')
    print(f'Removed {len(removed)} empty synthetic audit accounts.')


if __name__ == '__main__':
    main()
