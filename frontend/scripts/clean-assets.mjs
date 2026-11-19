import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const defaultStaticDir = fileURLToPath(new URL("../../app/static", import.meta.url));

export function cleanStaticAssets(staticDir = defaultStaticDir) {
  fs.rmSync(path.join(staticDir, "app.js"), { force: true });
  const assetsDir = path.join(staticDir, "assets");
  if (!fs.existsSync(assetsDir)) return;
  for (const name of fs.readdirSync(assetsDir)) {
    if (name.endsWith(".js") || name.endsWith(".css")) {
      fs.unlinkSync(path.join(assetsDir, name));
    }
  }
}

const isCliEntry = () => {
  if (!process.argv[1]) return false;
  try {
    return (
      fs.realpathSync(process.argv[1]) ===
      fs.realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
};

if (isCliEntry()) {
  cleanStaticAssets(process.env.EC_CLEAN_STATIC_DIR || defaultStaticDir);
}
