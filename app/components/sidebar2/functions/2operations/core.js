import { handlePattern, handlePatternSubmit } from "./pattern.js";
import { handleAdd, handleAddSubmit } from "./add.js";
import { handleCleanupText, handleCleanupSubmit } from "./cleanup.js";
import { openfindbackdrop, createFindAndReplace } from "./find.js";
import { openWorkflowPanel } from "./workflow.js";

window.handlePattern = handlePattern;
window.handlePatternSubmit = handlePatternSubmit;
window.handleAdd = handleAdd;
window.handleAddSubmit = handleAddSubmit;
window.handleCleanupText = handleCleanupText;
window.handleCleanupSubmit = handleCleanupSubmit;
window.openfindbackdrop = openfindbackdrop;
window.findandreplace = createFindAndReplace();
window.openWorkflowPanel = openWorkflowPanel;
