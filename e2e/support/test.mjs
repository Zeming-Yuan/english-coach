/** Playwright fixtures backed by isolated real applications. */
import {startLegacy} from "./legacy-app.mjs";
import {requirements} from "../spec-coverage.mjs";
import {createRequire} from "node:module";
import {startApp, pythonBin, readPort, stopChild, closeApps} from "./app.mjs";
const {test: base, expect} = createRequire(new URL("../../frontend/package.json", import.meta.url))("@playwright/test");
export {pythonBin} from "./app.mjs";

export const test = base.extend({
  legacyAppFactory: async ({}, use) => {
    const instances = [];
    try {
      await use(async options => {
        const instance = await startLegacy(options, {pythonBin, readPort, stopChild});
        instances.push(instance); return instance;
      });
    } finally { await closeApps(instances); }
  },
  app: async ({}, use) => {
    const instance = await startApp();
    try {
      await use(instance);
    } finally {
      await instance.close();
    }
  },
  appFactory: async ({}, use) => {
    const instances = [];
    const factory = async (options = {}) => {
      const instance = await startApp(options);
      instances.push(instance);
      return instance;
    };
    try {
      await use(factory);
    } finally {
      await closeApps(instances);
    }
  },
});

test.beforeEach(async ({}, testInfo) => {
  for (const [id, titles] of Object.entries(requirements)) {
    if (titles.includes(testInfo.title)) testInfo.annotations.push({type: "spec", description: id});
  }
});

export {expect};
