// make test (gjs -m test/order.test.js): exits 1 on a failure.

import System from 'system';

import {placeFolders, rawIndex} from '../order.js';

let failed = 0;
function check(name, got, want) {
    if (JSON.stringify(got) === JSON.stringify(want))
        return;
    failed++;
    print(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

check('one folder after the first icon',
    placeFolders(['A', 'B', 'C'], [{item: 'F', pos: 1}]), ['A', 'F', 'B', 'C']);
check('at the start',
    placeFolders(['A', 'B'], [{item: 'F', pos: 0}]), ['F', 'A', 'B']);
check('no position: after all',
    placeFolders(['A', 'B'], [{item: 'F', pos: Infinity}]), ['A', 'B', 'F']);
check('position past the end is clamped',
    placeFolders(['A', 'B'], [{item: 'F', pos: 9}]), ['A', 'B', 'F']);
check('two folders, given out of order',
    placeFolders(['A', 'B', 'C'], [{item: 'G', pos: Infinity}, {item: 'F', pos: 1}]),
    ['A', 'F', 'B', 'C', 'G']);
check('same position keeps their order',
    placeFolders(['A', 'B'], [{item: 'G', pos: 1}, {item: 'F', pos: 1}]), ['A', 'G', 'F', 'B']);
check('two Infinity positions keep their order',
    placeFolders(['A'], [{item: 'G', pos: Infinity}, {item: 'F', pos: Infinity}]), ['A', 'G', 'F']);

const isFolder = a => a === 'F';
check('raw index before the folder', rawIndex(['A', 'F', 'B', 'C'], isFolder, 0), 0);
check('raw index skips the folder', rawIndex(['A', 'F', 'B', 'C'], isFolder, 1), 2);
check('raw index past the last icon', rawIndex(['A', 'F', 'B', 'C'], isFolder, 3), 4);
check('raw index with a folder first', rawIndex(['F', 'A'], isFolder, 0), 1);

if (failed > 0)
    System.exit(1);
print('ok');
