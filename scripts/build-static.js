// 정적 호스팅(GitHub Pages 등)용 빌드: dist/ 에 오프라인 모드로 동작하는 파일 일체를 복사
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), DIST, { recursive: true });
fs.cpSync(path.join(ROOT, 'shared'), path.join(DIST, 'shared'), { recursive: true });
fs.mkdirSync(path.join(DIST, 'vendor/three'), { recursive: true });
for (const f of ['three.module.js', 'three.core.js']) {
  fs.copyFileSync(path.join(ROOT, 'node_modules/three/build', f), path.join(DIST, 'vendor/three', f));
}
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
console.log('✅ dist/ 생성 완료 — 아무 정적 웹 서버에 올리면 오프라인 모드로 플레이할 수 있습니다.');
