/**
 * True when the Next server is running inside the packaged Electron app (or
 * `electron:dev`). Desktop builds use Anypoint username/password login instead
 * of baking Connected App secrets into the artifact.
 */
export function isElectronDesktop(): boolean {
  return process.env.ELECTRON_DESKTOP === "1";
}
