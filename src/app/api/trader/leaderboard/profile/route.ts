import { NextRequest, NextResponse } from "next/server";
import { requireTrader, withApiErrorHandling } from "@/lib/auth/guards";
import { updateLeaderboardProfile } from "@/lib/services/leaderboard";
import { leaderboardProfileSchema } from "@/lib/validation/growth";

export async function PATCH(req: NextRequest) {
  return withApiErrorHandling(async () => {
    const user = await requireTrader();
    const data = leaderboardProfileSchema.parse(await req.json());
    return NextResponse.json(await updateLeaderboardProfile(user.id, data));
  });
}
