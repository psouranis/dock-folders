// Where the folders sit in a dock's row of icons, as plain functions so they
// can be tested without GNOME Shell (test/order.test.js).

// The row with each folder put back after `pos` of the dock's own icons
// (`others`); a pos past the end (or Infinity) puts it after them all.
// Folders with the same pos keep their order. `folders`: [{item, pos}].
export function placeFolders(others, folders) {
    const order = [...others];
    folders
        .map((folder, i) => ({...folder, i}))
        .sort((a, b) => a.pos - b.pos || a.i - b.i)
        .forEach(({item, pos}, inserted) => {
            order.splice(Math.min(pos, others.length) + inserted, 0, item);
        });
    return order;
}

// The index in `children` of the dock's own icon number `index`, folders
// skipped; past the last one, the end of the row.
export function rawIndex(children, isFolder, index) {
    let seen = 0;
    for (let i = 0; i < children.length; i++) {
        if (isFolder(children[i]))
            continue;
        if (seen === index)
            return i;
        seen++;
    }
    return children.length;
}
