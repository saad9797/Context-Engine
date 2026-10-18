import json
import shutil
import subprocess
from pathlib import Path

import pytest
from .serializers import IngestionJobCreateSerializer
from .workers import WindowsWorker
from unittest.mock import MagicMock


def test_mysql_job_is_valid_and_sql_connections_are_exclusive():
    identifier = "2ec5ae69-6ce2-4b9b-9147-8bd4eaed079b"
    serializer = IngestionJobCreateSerializer(data={"mysql_connection_id": identifier})
    assert serializer.is_valid(), serializer.errors
    both = IngestionJobCreateSerializer(data={"mysql_connection_id": identifier, "postgres_connection_id": identifier})
    assert not both.is_valid()


def test_worker_dequeue_timeout_is_safe_during_initialization():
    worker = WindowsWorker.__new__(WindowsWorker)
    assert worker.dequeue_timeout == 15
    worker.connection = MagicMock()
    worker.connection.connection_pool.connection_kwargs = {"socket_timeout": 30}
    assert worker.dequeue_timeout + 10 < 30
    worker.connection.connection_pool.connection_kwargs = {"socket_timeout": 12}
    assert worker.dequeue_timeout == 2


@pytest.mark.skipif(not shutil.which("node"), reason="Node required")
def test_mysql_inspector_queries_metadata_only_and_preserves_enum():
    script = """
      const assert = require('node:assert/strict');
      const guard = require.resolve('./src/ssrf-guard');
      require.cache[guard] = { loaded:true, exports: {assertSafeConnectionString: async () => {}, allowedHostsFromEnv: () => []} };
      const mysql = require.resolve('mysql2/promise');
      let ended = false; let options; const calls = [];
      require.cache[mysql] = { loaded:true, exports: {createConnection: async (config) => {
        options = config;
        return {query: async (query) => {
          calls.push(query);
          if (query.sql.includes('information_schema.COLUMNS')) return [[{TABLE_NAME:'interviews',COLUMN_NAME:'status',ORDINAL_POSITION:1,DATA_TYPE:'enum',COLUMN_TYPE:"enum('SCHEDULED','CANCELLED')",IS_NULLABLE:'NO',COLUMN_KEY:'',COLUMN_DEFAULT:'SCHEDULED'}]];
          return [[]];
        }, end: async () => {ended = true;}};
      }}};
      (async () => {
        const result = await require('./src/mysql/inspector').inspectMySQL('mysql://reader:password@db.example.com:3306/project');
        assert.equal(result.dialect, 'mysql');
        assert.equal(options.ssl.rejectUnauthorized, true);
        assert.equal(options.multipleStatements, false);
        assert.equal(ended, true);
        assert.ok(calls.every(q => q.sql.includes('information_schema.') && q.values[0] === 'project' && q.timeout === 15000));
        assert.equal(result.enums[0].definition, "enum('SCHEDULED','CANCELLED')");
        assert.ok(!JSON.stringify(result).includes('password'));
        console.log(JSON.stringify({ok: true}));
      })().catch(e => {console.error(e); process.exit(1);});
    """
    process = subprocess.run(["node", "-e", script], cwd=Path(__file__).parent / "ingestion-engine", capture_output=True, text=True, encoding="utf-8", timeout=15)
    assert process.returncode == 0, process.stderr
    assert json.loads(process.stdout)["ok"]
