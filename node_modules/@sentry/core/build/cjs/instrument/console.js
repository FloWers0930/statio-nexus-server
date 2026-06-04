Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const debugBuild = require('../debug-build.js');
const debugLogger = require('../utils/debug-logger.js');
const object = require('../utils/object.js');
const string = require('../utils/string.js');
const worldwide = require('../utils/worldwide.js');
const handlers = require('./handlers.js');

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-types */

/**
 * Filter out console messages that match the given strings or regular expressions.
 * These will neither be passed to the handler, and they will also not be logged to the user, unless they have debug enabled.
 * This is a set to avoid duplicate integration setups to add the same filter multiple times.
 */
const _filter = new Set([]);

/**
 * Add an instrumentation handler for when a console.xxx method is called.
 * Returns a function to remove the handler.
 *
 * Use at your own risk, this might break without changelog notice, only used internally.
 * @hidden
 */
function addConsoleInstrumentationHandler(handler) {
  const type = 'console';
  const removeHandler = handlers.addHandler(type, handler);
  handlers.maybeInstrument(type, instrumentConsole);
  return removeHandler;
}

/**
 * Add a filter to the console instrumentation to filter out console messages that match the given strings or regular expressions.
 * Returns a function to remove the filter.
 */
function addConsoleInstrumentationFilter(filter) {
  for (const f of filter) {
    _filter.add(f);
  }

  return () => {
    for (const f of filter) {
      _filter.delete(f);
    }
  };
}

function instrumentConsole() {
  if (!('console' in worldwide.GLOBAL_OBJ)) {
    return;
  }

  debugLogger.CONSOLE_LEVELS.forEach(function (level) {
    if (!(level in worldwide.GLOBAL_OBJ.console)) {
      return;
    }

    object.fill(worldwide.GLOBAL_OBJ.console, level, function (originalConsoleMethod) {
      debugLogger.originalConsoleMethods[level] = originalConsoleMethod;

      return function (...args) {
        const firstArg = args[0];
        const log = debugLogger.originalConsoleMethods[level];

        const isFiltered = _filter.size && typeof firstArg === 'string' && string.stringMatchesSomePattern(firstArg, _filter);

        // Only trigger handlers for non-filtered messages
        if (!isFiltered) {
          handlers.triggerHandlers('console', { args, level } );
        }

        // Only log filtered messages in debug mode
        if (!isFiltered || (debugBuild.DEBUG_BUILD && debugLogger.debug.isEnabled())) {
          // Call original console method
          log?.apply(worldwide.GLOBAL_OBJ.console, args);
        }
      };
    });
  });
}

exports.addConsoleInstrumentationFilter = addConsoleInstrumentationFilter;
exports.addConsoleInstrumentationHandler = addConsoleInstrumentationHandler;
//# sourceMappingURL=console.js.map
