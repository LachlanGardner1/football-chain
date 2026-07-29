import { exec } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const portsToCheck = [3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010];

function run(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error && !stderr && !stdout) {
        resolve('');
        return;
      }
      if (error) {
        resolve(stderr || stdout || '');
        return;
      }
      resolve(stdout || stderr || '');
    });
  });
}

async function cleanup() {
  try {
    rmSync(join(process.cwd(), '.next'), { recursive: true, force: true });
    console.log('Cleared .next build cache');
  } catch {
    // Ignore cache cleanup errors.
  }

  for (const port of portsToCheck) {
    try {
      const output = await run(`netstat -ano | findstr :${port}`);
      const match = output.match(/LISTENING\s+(\d+)/i);
      if (match) {
        const pid = match[1];
        await run(`taskkill /F /PID ${pid}`);
        console.log(`Stopped process ${pid} using port ${port}`);
      }
    } catch {
      // Ignore cleanup failures for ports that are already free.
    }
  }
}

cleanup().catch(() => {
  process.exit(0);
});
