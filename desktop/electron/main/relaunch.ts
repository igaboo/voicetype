import { app } from "electron";
import { allowWindowCloseForQuit } from "./windows";

export async function relaunchApp(beforeExit?: () => Promise<void> | void): Promise<void> {
  allowWindowCloseForQuit();

  if (beforeExit) {
    try {
      await beforeExit();
    } catch (error) {
      console.warn("[yap] continuing relaunch after cleanup failed:", error);
    }
  }

  app.relaunch();
  app.exit(0);
}
