/* Module-resolution hooks so `node --test` can import the app's real route
   handlers: maps the Next.js '@/…' alias to src/, and retries extensionless
   package subpaths (e.g. 'next/server', 'next-auth/providers/google') with
   '.js', which Next's bundler resolves but Node's strict ESM loader won't. */
import { pathToFileURL } from 'node:url';
import { statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('src');
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const base = path.join(SRC, specifier.slice(2));
    const hit = [base, `${base}.js`, path.join(base, 'index.js')].find(isFile);
    if (hit) return next(pathToFileURL(hit).href, context);
  }
  try {
    return await next(specifier, context);
  } catch (err) {
    const lastSegment = specifier.split('/').pop();
    const bareSubpath = !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('file:')
      && specifier.includes('/') && !specifier.endsWith('.js');
    const relativeNoExt = specifier.startsWith('.') && !lastSegment.includes('.');
    if (err?.code === 'ERR_MODULE_NOT_FOUND' && (bareSubpath || relativeNoExt)) return next(`${specifier}.js`, context);
    throw err;
  }
}
