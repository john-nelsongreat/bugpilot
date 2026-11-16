// One re-export line, and the line is the entire point. The leak this guard tests does not travel through a
// direct import of a mocked specifier: each file re-resolves the names it itself imports, so a later file
// importing ./app/useWorkspace gets the real module even when src/test/setup.ts's afterAll reset is missing.
// It travels through an already-evaluated module instead, because that instance and the binding it captured
// are what the shared registry caches. Measured both ways in
// handoff-audit/evidence/m1i/v6probe-20261116T200552Z.log, arms 1 and 2. This file is that evaluated module,
// reduced to one line so the guard depends on the caching mechanism and on nothing else. It is not a test
// file, so vitest does not collect it and the suite denominators do not move.
export { useWorkspace, WorkspaceContext } from '../app/useWorkspace'
