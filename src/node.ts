// The only place cap-sort reaches Node and Electron directly. Obsidian desktop exposes `require` on window;
// everything is typed here so the rest of the code never handles `any`.
import type * as ChildProcess from "child_process";
import type * as Fs from "fs";
import { getRemote, type Remote } from "./util.ts";

const nodeRequire = (id: string): unknown => (window as unknown as { require: (id: string) => unknown }).require(id);

/** Used only to run the cursor helper (see README, "The cursor helper"). */
export const childProcess = (): typeof ChildProcess => nodeRequire("child_process") as typeof ChildProcess;
/** Used only to install the cursor helper into this plugin's folder and mark it executable. */
export const fs = (): typeof Fs => nodeRequire("fs") as typeof Fs;
export const electronRemote = (): Remote => getRemote(nodeRequire);
