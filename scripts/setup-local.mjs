import { constants } from "node:fs";
import { copyFile, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dirname, "..");

const contracts = new Map([
  [
    "apps/accounts/.dev.vars.example",
    [
      "PUBLIC_URL=http://localhost:8790",
      "PUBLIC_HANDLE_DOMAIN=r2d2.test",
      "PDS_ORIGIN=http://localhost:8787",
    ],
  ],
  [
    "apps/pds/.dev.vars.example",
    [
      "ACCOUNTS_ORIGIN=http://localhost:8790",
      "PDS_ORIGIN=http://localhost:8787",
    ],
  ],
  [
    "examples/town/.dev.vars.example",
    [
      "DEV_HANDLE_RESOLVER_ORIGIN=http://localhost:8789",
      "PLC_DIRECTORY_ORIGIN=http://localhost:8788",
      "PUBLIC_URL=http://127.0.0.1:5174",
    ],
  ],
  ["apps/accounts/vite.config.ts", ["port: 8790,", "strictPort: true,"]],
  ["apps/directory/wrangler.jsonc", ['"port": 8788,']],
  ["apps/handle-registry/wrangler.jsonc", ['"port": 8789,']],
  ["apps/pds/wrangler.jsonc", ['"port": 8787,']],
  ["examples/town/vite.config.ts", ["port: 5174,", "strictPort: true,"]],
]);

const validateTopology = async () => {
  await Promise.all(
    [...contracts].map(async ([file, expectedValues]) => {
      const contents = await readFile(path.join(workspaceRoot, file), "utf-8");
      for (const expectedValue of expectedValues) {
        if (!contents.includes(expectedValue)) {
          throw new Error(
            `Local topology mismatch in ${file}: ${expectedValue}`
          );
        }
      }
    })
  );
  console.log("Validated the local AT Protocol topology.");
};

const findTemplates = async () => {
  const projectGroups = await Promise.all(
    ["apps", "examples"].map(async (group) => {
      const groupPath = path.join(workspaceRoot, group);
      const projects = await readdir(groupPath, { withFileTypes: true });
      return projects
        .filter((project) => project.isDirectory())
        .map((project) => path.join(groupPath, project.name));
    })
  );
  const templateGroups = await Promise.all(
    projectGroups.flat().map(async (projectPath) => {
      const entries = await readdir(projectPath, { withFileTypes: true });
      return entries
        .filter(
          (entry) =>
            entry.isFile() &&
            [".dev.vars.example", ".env.example"].includes(entry.name)
        )
        .map((entry) => path.join(projectPath, entry.name));
    })
  );
  return templateGroups.flat().toSorted();
};

const createLocalFiles = async () => {
  const templates = await findTemplates();
  const results = await Promise.all(
    templates.map(async (source) => {
      const destination = source.slice(0, -".example".length);
      const relativeDestination = path.relative(workspaceRoot, destination);
      try {
        await copyFile(source, destination, constants.COPYFILE_EXCL);
        return `Created ${relativeDestination}`;
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        ) {
          return `Preserved ${relativeDestination}`;
        }
        throw error;
      }
    })
  );
  for (const result of results) {
    console.log(result);
  }
};

await validateTopology();
await createLocalFiles();
