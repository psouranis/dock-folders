// make test (gjs -m test/order.test.js): exits 1 on a failure.

import System from 'system';

import {folderEntries, moveInRow, newFolderId, placeFolders, rawIndex} from '../order.js';

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

check('a folder id: letters and digits of its name', newFolderId('Read & Write', []), 'ReadWrite');
check('a folder id: accents dropped', newFolderId('Café 2', []), 'Cafe2');
check('a folder id: a name with no letters', newFolderId('Μουσική', []), 'Folder');
check('a folder id: numbered when taken', newFolderId('Work', ['Work', 'Work2']), 'Work3');

// Two folders in the same gap (A [F] [G] B), as the bug had them: they swap.
const row = [{}, {folder: 'F'}, {folder: 'G'}, {}];
check('swap two folders in one gap: entries', folderEntries(moveInRow(row, 'F', 2)),
    [{id: 'G', position: 1}, {id: 'F', position: 1}]);
check('...and placeFolders puts them back in that order',
    placeFolders(['A', 'B'], folderEntries(moveInRow(row, 'F', 2)).map(e => ({item: e.id, pos: e.position}))),
    ['A', 'G', 'F', 'B']);
check('move a folder past an app', folderEntries(moveInRow(row, 'G', 3)),
    [{id: 'F', position: 1}, {id: 'G', position: 2}]);
check('to the start', folderEntries(moveInRow(row, 'G', 0)),
    [{id: 'G', position: 0}, {id: 'F', position: 1}]);
check('index past the end is clamped', folderEntries(moveInRow(row, 'F', 99)),
    [{id: 'G', position: 1}, {id: 'F', position: 2}]);

if (failed > 0)
    System.exit(1);
print('ok');
