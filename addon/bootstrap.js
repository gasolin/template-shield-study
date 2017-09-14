"use strict";

/* global  __SCRIPT_URI_SPEC__  */
/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "(startup|shutdown|install|uninstall)" }]*/

const { interfaces: Ci, utils: Cu } = Components;
Cu.import("resource://gre/modules/Console.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

const CONFIGPATH = `${__SCRIPT_URI_SPEC__}/../Config.jsm`;
const STUDYUTILSPATH = `${__SCRIPT_URI_SPEC__}/../${studyConfig.studyUtilsPath}`;

const { config } = Cu.import(CONFIGPATH, {});
const { study: studyConfig} = config;
const { studyUtils } = Cu.import(STUDYUTILSPATH, {});

const REASONS = studyUtils.REASONS;

const log = createLog(studyConfig.study.studyName, config.log.bootstrap.level);  // defined below.

/* Example addon-specific module imports.  Remember to Unload.
   Ideally, put ALL your feature code in a Feature.jsm file,
   NOT in this bootstrap.js.

  const BASE=`template-shield-study`;
  XPCOMUtils.defineLazyModuleGetter(this, "SomeExportedSymbol",
    `resource://${BASE}/SomeModule.jsm");

  XPCOMUtils.defineLazyModuleGetter(this, "Preferences",
    "resource://gre/modules/Preferences.jsm");
*/

async function startup(addonData, reason) {
  // addonData: Array [ "id", "version", "installPath", "resourceURI", "instanceID", "webExtension" ]  bootstrap.js:48
  log("startup", REASONS[reason] || reason);

  // setup the studyUtils so that Telemetry is valid
  studyUtils.setup({
    study: {
      studyName: studyConfig.studyName,
      endings: studyConfig.endings
    }
    addon: {
      id: addonData.id,
      version: addonData.version
    },
    telemetry: studyConfig.telemetry,
    log: {
      level: config.log.studyUtils.level
    }
  });

  // choose the variation for this particular user, then set it.
  const variation = (studyConfig.forceVariation ||
    await studyUtils.deterministicVariation(
      studyConfig.weightedVariations
    );
  );
  studyUtils.setVariation(variation);

  // Actually, define a function that does this, per study
  Jsm.import(config.modules);

  // addon_install:  note first seen, check eligible
  if ((REASONS[reason]) === "ADDON_INSTALL") {
    studyUtils.firstSeen();  // sends telemetry "enter"
    const eligible = await config.isEligible(); // addon-specific
    if (!eligible) {
      // uses config.endings.ineligible.url if any,
      // sends UT for "ineligible"
      // then uninstalls addon
      await studyUtils.endStudy({reason: "ineligible"});
      return;
    }
  }

  // for all 'eligible' users, startup.
  await studyUtils.startup({reason});

  // log what the study variation and other info is.
  console.log(`info ${JSON.stringify(studyUtils.info())}`);


  // if you have code to handle expiration / long-timers, it could go here
  ;

  // If your study has an embedded webExtension, start it.
  const webExtension = addonData.webExtension;
  if (webExtenion) {
    webExtension.startup().then(api => {
      const {browser} = api;
      /* spec for messages intended for Shield =>
        {shield:true,msg=[info|endStudy|telemetry],data=data}
      */
      browser.runtime.onMessage.addListener(studyUtils.respondToWebExtensionMessage);

      // other browser.runtime.onMessage handlers for your addon, if any
      ;
    });
  }
}


function shutdown(addonData, reason) {
  console.log("shutdown", REASONS[reason] || reason);
  // FRAGILE: handle uninstalls initiated by USER or by addon
  if (reason === REASONS.ADDON_UNINSTALL || reason === REASONS.ADDON_DISABLE) {
    console.log("uninstall or disable");
    if (!studyUtils._isEnding) {
      // we are the first 'uninstall' requestor => must be user action.
      console.log("user requested shutdown");
      studyUtils.endStudy({reason: "user-disable"});
      return;
    }
    // normal shutdown, or 2nd uninstall request
    console.log("Jsms unloading");
    Jsm.unload([CONFIGPATH, STUDYUTILSPATH]);

    // QA NOTE:  unload addon specific modules here.
    ;
  }
}

function uninstall(addonData, reason) {
  console.log("uninstall", REASONS[reason] || reason);
}

function install(addonData, reason) {
  console.log("install", REASONS[reason] || reason);
  // handle ADDON_UPGRADE (if needful) here
}

/** CONSTANTS and other bootstrap.js utilities */

// logging
function createLog(name, levelWord) {
  Cu.import("resource://gre/modules/Log.jsm");
  var L = Log.repository.getLogger(name);
  L.addAppender(new Log.ConsoleAppender(new Log.BasicFormatter()));
  L.level = Log.Level[levelWord] || Log.Level.Debug; // should be a config / pref
  return L;
}

// jsm loader / unloader
class Jsm {
  static import(modulesArray) {
    for (const module of modulesArray) {
      log.debug(`loading ${module}`);
      Cu.import(module);
    }
  }
  static unload(modulesArray) {
    for (const module of modulesArray) {
      log.debug(`Unloading ${module}`);
      Cu.unload(module);
    }
  }
}
