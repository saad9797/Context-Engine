// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ZipWriter, Uint8ArrayWriter, TextReader } from '@zip.js/zip.js';
import { prepareZip, maxZipBytes } from './zipImport';

async function archive(entries) {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [path, content] of Object.entries(entries)) {
    await writer.add(path, new TextReader(content));
  }
  return Object.assign(new Blob([await writer.close()]), { name: 'billing.zip' });
}

describe('local ZIP import', () => {
  it('preserves project paths and filters secrets and dependencies before upload', async () => {
    const result = await prepareZip(await archive({
      'billing/src/invoice.ts': 'export const invoice = 1;',
      'billing/package.json': '{}',
      'billing/.env.production': 'SECRET=private',
      'billing/node_modules/lib/index.js': 'dependency',
    }));
    expect(result.projectName).toBe('billing');
    expect(result.files.map(file => file.path)).toEqual(['src/invoice.ts', 'package.json']);
    expect(result.ignoredFiles).toBe(2);
    expect(result.omittedSourceFiles).toBe(0);
    expect(JSON.stringify(result.files)).not.toContain('private');
  });

  it('reports oversized expanded source separately from routine exclusions', async () => {
    const result = await prepareZip(await archive({
      'src/ok.py': 'pass',
      'src/huge.py': 'x'.repeat(512001),
    }));
    expect(result.files).toHaveLength(1);
    expect(result.omittedSourceFiles).toBe(1);
    expect(result.skipped[0].reason).toBe('Larger than 512 KB');
  });

  it('does not strip a dependency root to bypass exclusions', async () => {
    const result = await prepareZip(await archive({ 'node_modules/index.js': 'dependency' }));
    expect(result.files).toHaveLength(0);
  });

  it('rejects oversized and invalid archives', async () => {
    await expect(prepareZip({ size: maxZipBytes + 1 })).rejects.toThrow('25 MB');
    await expect(prepareZip(Object.assign(new Blob(['not a zip']), { name: 'bad.zip' }))).rejects.toThrow();
  });
});
