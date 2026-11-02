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

// An id for a new app-grid folder named `name`: its letters and digits (the
// id is a dconf path element), "Folder" if none, and a number after it when
// `taken` (the folder ids there are) has it already.
export function newFolderId(name, taken) {
    const base = (name ?? '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '') || 'Folder';
    let id = base;
    for (let n = 2; taken.includes(id); n++)
        id = `${base}${n}`;
    return id;
}

// A dock's row as the folders see it: one entry per icon in order, a folder
// as {folder: id}, any other icon as {}. moveInRow puts folder `id` at
// `index` of the row without it; folderEntries gives each folder's config
// entry, in row order: its position (how many other icons come before it)
// and, by that order, its place among folders in the same gap.
export function moveInRow(row, id, index) {
    const rest = row.filter(t => t.folder !== id);
    rest.splice(Math.max(0, Math.min(index, rest.length)), 0, {folder: id});
    return rest;
}

export function folderEntries(row) {
    let icons = 0;
    const entries = [];
    for (const t of row) {
        if (t.folder !== undefined)
            entries.push({id: t.folder, position: icons});
        else
            icons++;
    }
    return entries;
}
