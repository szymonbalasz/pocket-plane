// fog-of-war's command defs for fixture steps (only `name` and the input schema are used).
import { fogCommands } from "@server/features/fog-of-war/commands";
import { silentLogger } from "@server/log";

export const fog = fogCommands(silentLogger);
