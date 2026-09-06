import { handleRename, handleRenameSubmit } from "./rename.js";
import { handleDownload, handleDownloadSubmit } from "./download.js";
import { handleOpenFile } from "./open.js";
import { toggleFullscreen } from "./fullscreen.js";
import { increaseFontSize, decreaseFontSize } from "./fontsize.js";
import { createDebugTool } from "./debug.js";
import { foldAll, unfoldAll, removeContentInsideFolds } from "./fold.js";

window.handleRename = handleRename;
window.handleRenameSubmit = handleRenameSubmit;

window.handleDownload = handleDownload;
window.handleDownloadSubmit = handleDownloadSubmit;

window.handleOpenFile = handleOpenFile;

window.toggleFullscreen = toggleFullscreen;

window.increaseFontSize = increaseFontSize;
window.decreaseFontSize = decreaseFontSize;

window.foldAll = foldAll;
window.unfoldAll = unfoldAll;
window.removeContentInsideFolds = removeContentInsideFolds;

const debugFn = createDebugTool();
if (debugFn) window.debug = debugFn;
