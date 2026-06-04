import { DEBUG_BUILD } from '../debug-build.js';
import { CONSOLE_LEVELS, originalConsoleMethods, debug } from '../utils/debug-logger.js';
import { fill } from '../utils/object.js';
import { stringMatchesSomePattern } from '../utils/string.js';
import { GLOBAL_OBJ } from '../utils/worldwide.js';
import { addHandler, maybeInstrument, triggerHandlers } from './handlers.js';

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
  const removeHandler = addHandler(type, handler);
  maybeInstrument(type, instrumentConsole);
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
  if (!('console' in GLOBAL_OBJ)) {
    return;
  }

  CONSOLE_LEVELS.forEach(function (level) {
    if (!(level in GLOBAL_OBJ.console)) {
      return;
    }

    fill(GLOBAL_OBJ.console, level, function (originalConsoleMethod) {
      originalConsoleMethods[level] = originalConsoleMethod;

      return function (...args) {
        const firstArg = args[0];
        const log = originalConsoleMethods[level];

        const isFiltered = _filter.size && typeof firstArg === 'string' && stringMatchesSomePattern(firstArg, _filter);

        // Only trigger handlers for non-filtered messages
        if (!isFiltered) {
          triggerHandlers('console', { args, level } );
        }

        // Only log filtered messages in debug mode
        if (!isFiltered || (DEBUG_BUILD && debug.isEnabled())) {
          // Call original console method
          log?.apply(GLOBAL_OBJ.console, args);
        }
      };
    });
  });
}

export { addConsoleInstrumentationFilter, addConsoleInstrumentationHandler };
//# sourceMappingURL=console.js.map
