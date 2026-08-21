"use client";

import { useEffect } from "react";
import { installConsoleBuffer } from "@/lib/feedback/console-buffer";

/** Mount once to capture recent console errors for bug reports. */
export default function ConsoleBufferInit() {
  useEffect(() => {
    installConsoleBuffer();
  }, []);
  return null;
}
