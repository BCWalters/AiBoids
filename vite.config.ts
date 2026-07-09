import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

function readGitBranch(): string {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return branch === 'HEAD' ? '' : branch;
  } catch {
    return '';
  }
}

export default defineConfig(() => ({
  define: {
    'import.meta.env.VITE_GIT_BRANCH': JSON.stringify(readGitBranch()),
  },
}));
