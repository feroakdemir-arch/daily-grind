# jsPDF

`jspdf.umd.min.js` is the pinned jsPDF 4.2.1 browser bundle from the official `jspdf` npm package. Its license is retained in `JSPDF-LICENSE.txt`. Organized Me uses it only in the browser to download one open note as a PDF; note content and screenshots are not sent to a PDF service.

The exporter is implemented in `note-pdf.js`. It renders title and metadata, normal text, positioned text boxes, freehand ink, page numbers, and referenced screenshots. Screenshot assets are loaded through the account-scoped `noteImageStore`; missing or corrupt assets stop the download instead of silently producing an incomplete PDF.
