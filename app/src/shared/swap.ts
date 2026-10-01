/**
 * MANUAL EDIT = SWAP. Every hall of a session is taken (staff count = hall count, R7), so an
 * edit gives person A the hall that B holds, and B takes A's hall. R1 (no hall twice in a
 * person's current rotation cycle) must hold for BOTH of them: a swap that is fine for A can
 * hand B a hall B already had in B's cycle. Used by the desktop and the web build.
 */
import { visitedThisCycle, type HallHistory } from "./assignment"

export interface SwapPlan {
  fromHallId: number | null      // A's current hall, which B receives (null: A has no hall in this session)
  partnerUserId: number | null   // B, who holds the target hall (null: the hall is free, a plain move)
  selfRepeat: boolean            // A already had the target hall in A's current cycle
  partnerRepeat: boolean         // B already had A's hall in B's current cycle
}

/** R1 for both people in "give `userId` the hall `targetHallId`", over the session's hall pool. */
export function planSwap(
  entries: { userId: number; hallId: number }[],
  userId: number,
  targetHallId: number,
  pool: number[],
  historyOf: HallHistory
): SwapPlan {
  const mine = entries.find(e => e.userId === userId)
  const partner = entries.find(e => e.hallId === targetHallId && e.userId !== userId)
  return {
    fromHallId: mine?.hallId ?? null,
    partnerUserId: partner?.userId ?? null,
    selfRepeat: visitedThisCycle(historyOf(userId), pool).has(targetHallId),
    partnerRepeat: partner && mine ? visitedThisCycle(historyOf(partner.userId), pool).has(mine.hallId) : false,
  }
}
