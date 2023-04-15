// Browser version
fetch('https://unpkg.com/@rollup/browser/dist/es/rollup.browser.js').then(r=>r.text()).then(utf8=> new Blob([utf8],{ type: 'text/javascript'})).then(URL.createObjectURL).then((blobURL)=>import(blobURL));
// node will need buffer and will maybe even crash this is horror code.
