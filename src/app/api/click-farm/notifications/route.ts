// GET /api/click-farm/notifications - 获取用户通知
// src/app/api/click-farm/notifications/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getUserNotifications } from '@/lib/click-farm/notifications';

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const notifications = await getUserNotifications(parseInt(userId));

    return NextResponse.json({
      success: true,
      data: { notifications, count: notifications.length }
    });
  } catch (error: any) {
    console.error('Failed to fetch notifications:', error);
    return NextResponse.json(
      { error: 'Failed to fetch notifications', message: error.message },
      { status: 500 }
    );
  }
}
