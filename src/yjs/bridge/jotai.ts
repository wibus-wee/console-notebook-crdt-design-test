import * as Y from 'yjs'
import { USER_ACTION_ORIGIN } from '@/yjs/schema/core/origins'

/**
 * Wrap a set of Yjs mutations in a single user-action transaction.
 * Ensures consistent origin for undo manager and for read-side echo suppression.
 */
export const withUserAction = (doc: Y.Doc | undefined | null, fn: () => void) => {
  if (!doc) {
    fn()
    return
  }
  doc.transact(fn, USER_ACTION_ORIGIN)
}

/**
 * Utility to normalize observer callbacks to ignore local echo by origin.
 * Use within Y.Map/Y.Array/Y.Text .observe and .observeDeep callbacks.
 */
export const shouldIgnoreByOrigin = (tx: Y.Transaction | null | undefined): boolean =>
  tx?.origin === USER_ACTION_ORIGIN

