from pathlib import Path
import subprocess

from .views_context_packs import RebuildRequest


def test_rebuild_rejects_unsafe_paths_and_non_object_requests():
    for data in ([], {'include_paths': ['../auth.ts']}, {'include_paths': ['/src/auth.ts']},
                 {'include_paths': ['src/../auth.ts']}, {'include_paths': ['.env']},
                 {'include_paths': ['C:\\secret.ts']}, {'include_paths': ['private.key']}):
        assert not RebuildRequest(data=data).is_valid(), data
    assert RebuildRequest(data={'include_paths': ['src/utils/helper.ts']}).is_valid()


def test_capture_includes_generic_helpers_and_prioritizes_requested_files():
    engine = Path(__file__).parent / 'ingestion-engine'
    script = r'''
const assert = require('node:assert/strict');
const files = ['src/utils/helper.ts', ...Array.from({length:100}, (_,i)=>`src/misc/value${i}.ts`), 'src/misc/last.ts'];
class FakeOctokit {
  constructor() {
    this.repos = {
      get: async()=>({data:{default_branch:'main'}}),
      getContent: async()=>({data:{type:'file',content:Buffer.from('throw Error("source must never execute");').toString('base64')}}),
      listCommits: async()=>({data:[]}),
    };
    this.git = {
      getRef: async()=>({data:{object:{sha:'commit'}}}),
      getCommit: async()=>({data:{tree:{sha:'tree'}}}),
      getTree: async()=>({data:{tree:files.map(path=>({path,type:'blob',size:40,sha:'sha'}))}}),
    };
  }
}
const dependency = require.resolve('@octokit/rest');
require.cache[dependency] = {id:dependency,filename:dependency,loaded:true,exports:{Octokit:FakeOctokit}};
const {inspectGitHub} = require('./src/github/inspector');
inspectGitHub({token:'test-only',owner:'fixture',repo:'fixture',includePaths:['src/misc/last.ts']}).then(result=>{
  const paths=Object.values(result.key_files_by_role).flat().map(f=>f.path);
  assert(paths.includes('src/utils/helper.ts'));
  assert(paths.includes('src/misc/last.ts'));
  assert.equal(result.capture.unavailable_requested_paths.length,0);
  assert(result.key_files_truncated);
}).catch(e=>{console.error(e);process.exitCode=1;});
'''
    result = subprocess.run(['node', '-e', script], cwd=engine, capture_output=True, encoding='utf-8', timeout=20)
    assert result.returncode == 0, result.stderr
