import { importExclusion, importLimits, prepareFolder } from './folderImport';

export const maxZipBytes = 25000000;

export async function prepareZip(file) {
  if (file.size > maxZipBytes) throw new Error('Choose a ZIP smaller than 25 MB. Leave out node_modules, virtual environments, .git, and build output.');
  const { BlobReader, ZipReader } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = [];
    for await (const entry of reader.getEntriesGenerator()) {
      if (entries.length >= 150000) throw new Error('This ZIP contains too many entries. Create a source-only ZIP without dependencies or build output.');
      entries.push(entry);
    }
    const files = entries.filter(entry => !entry.directory);
    const root = files[0]?.filename.split('/')[0];
    // Remove an archive's enclosing project folder, never a blocked directory.
    const stripRoot = root && !importExclusion(`${root}/source.ts`) && files.every(entry => entry.filename.startsWith(`${root}/`));
    const projectName = file.name.replace(/\.zip$/i, '') || 'Imported project';
    const input = files.map(entry => {
      const rawPath = entry.filename;
      const path = stripRoot ? rawPath.slice(root.length + 1) : rawPath;
      return {
        name: path,
        webkitRelativePath: `${projectName}/${path}`,
        size: entry.uncompressedSize,
        async text() {
          if (importExclusion(rawPath) || entry.encrypted || entry.symlink) throw new Error('Unsupported archive entry');
          let size = 0;
          const chunks = [];
          await entry.getData(new WritableStream({
            write(chunk) {
              size += chunk.byteLength;
              if (size > importLimits.fileBytes) throw new Error('Expanded file exceeds the source limit');
              chunks.push(chunk);
            },
          }), { checkSignature: true });
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        },
      };
    });
    const result = await prepareFolder(input);
    return { ...result, projectName };
  } finally {
    await reader.close();
  }
}
