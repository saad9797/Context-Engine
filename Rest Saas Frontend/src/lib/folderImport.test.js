import { describe, expect, it, vi } from 'vitest';
import { prepareFolder } from './folderImport';

function file(path, content, size = content.length) {
  return { name: path.split('/').pop(), webkitRelativePath: `project/${path}`, size, text: vi.fn().mockResolvedValue(content) };
}
describe('folder import privacy and bounds', () => {
  it('filters credentials and dependencies before reading them', async () => {
    const secret = file('.env', 'SECRET=real');
    const dependency = file('node_modules/a/index.js', 'third party');
    const source = file('src/invoice.ts', 'export const invoice = 1;');
    const result = await prepareFolder([secret, dependency, source]);
    expect(secret.text).not.toHaveBeenCalled(); expect(dependency.text).not.toHaveBeenCalled();
    expect(result.files).toEqual([{ path: 'src/invoice.ts', content: 'export const invoice = 1;' }]);
    expect(result.projectName).toBe('project'); expect(result.skipped).toHaveLength(2);
  });
  it('rejects traversal, duplicates, binary and oversized files without silently including them', async () => {
    const large = file('large.ts', 'x', 128001);
    const result = await prepareFolder([file('../escape.ts', 'x'), file('ok.py', 'pass'), file('OK.py', 'pass'), file('binary.py', '\0'), large]);
    expect(result.files).toEqual([{ path: 'ok.py', content: 'pass' }]);
    expect(result.skipped).toHaveLength(4); expect(large.text).not.toHaveBeenCalled();
  });
});
