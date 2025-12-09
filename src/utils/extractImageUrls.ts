const mdImageRE = /!\[[^\]]*?\]\(\s*(https?:\/\/[^\s)]+)\s*\)/gi;
const plainImgUrlRE = /(https?:\/\/[^\s)]+?\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?[^\s)]*)?)/gi;

export function extractImageUrls(content: string): string[] {
  if (!content) return [];
  const urls: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  mdImageRE.lastIndex = 0;
  while ((m = mdImageRE.exec(content))) {
    const u = m[1].trim();
    if (!seen.has(u)) { seen.add(u); urls.push(u); }
  }
  plainImgUrlRE.lastIndex = 0;
  while ((m = plainImgUrlRE.exec(content))) {
    const u = m[1].trim();
    if (!seen.has(u)) { seen.add(u); urls.push(u); }
  }
  return urls;
}
