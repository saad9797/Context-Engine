const source = /\.(?:[cm]?[jt]sx?|py|rb|go|java|cs|php|rs|vue|svelte|prisma|graphql|gql)$|(?:^|\/)tsconfig[^/]*\.json$/i;
const manifest = /(?:^|\/)(?:package\.json|requirements[^/]*\.txt|pyproject\.toml|go\.mod|Gemfile|composer\.json|Cargo\.toml|[^/]+\.csproj|pom\.xml)$/i;
const blocked = /(?:^|\/)(?:\.git|\.venv|venv|node_modules|vendor|dist|build|coverage|__pycache__|\.next|\.nuxt|fixtures?|seeds?|migrations?)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|credentials[^/]*|[^/]*\.(?:pem|key|p12|pfx))$/i;
export const importLimits = { files: 1200, fileBytes: 512000, totalBytes: 12000000 };

// Filter before reading: excluded files never enter the upload payload.
export function importExclusion(path) {
  if (!path || path.length > 500 || path.startsWith('/') || /[\\:\x00-\x1f]/.test(path) || path.split('/').some(s => s === '..' || s === '.')) return 'Unsafe path';
  if (blocked.test(path) || !(source.test(path) || manifest.test(path))) return 'Excluded: credentials, generated files or unsupported format';
  return null;
}

export async function prepareFolder(input) {
  const files = [...input];
  const accepted = [], skipped = [], seen = new Set();
  let bytes = 0;
  const projectName = files.find(f => f.webkitRelativePath)?.webkitRelativePath.split('/')[0] || 'Imported project';
  for (const file of files) {
    const path = file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name;
    let reason;
    reason = importExclusion(path);
    if (reason) { skipped.push({ path, reason }); continue; }
    if (seen.has(path.toLowerCase())) reason = 'Duplicate path';
    else if (file.size > importLimits.fileBytes) reason = 'Larger than 512 KB';
    else if (accepted.length >= importLimits.files || bytes + file.size > importLimits.totalBytes) reason = 'Import limit: choose a smaller project folder';
    if (reason) { skipped.push({ path, reason }); continue; }
    let content;
    try { content = await file.text(); }
    catch { skipped.push({ path, reason: 'Could not read source file' }); continue; }
    if (content.includes('\0') || content.includes('\ufffd')) { skipped.push({ path, reason: 'Not valid UTF-8 text' }); continue; }
    const size = new TextEncoder().encode(content).length;
    if (size > importLimits.fileBytes || bytes + size > importLimits.totalBytes) { skipped.push({ path, reason: 'Import byte limit exceeded' }); continue; }
    accepted.push({ path, content }); seen.add(path.toLowerCase()); bytes += size;
  }
  const omittedSourceFiles = skipped.filter(item => !item.reason.startsWith('Excluded:') && item.reason !== 'Duplicate path' && item.reason !== 'Unsafe path').length;
  return { files: accepted, skipped, bytes, projectName, omittedSourceFiles, ignoredFiles: skipped.length - omittedSourceFiles };
}
