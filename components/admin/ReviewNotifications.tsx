import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Bell, CheckSquare } from 'lucide-react';
import { usePendingContentCount } from '@/hooks/useMangaWithApproval';
import { useAuth } from '@/hooks/useAuth';

interface ReviewNotificationsProps {
  onOpenReview?: () => void;
}

export default function ReviewNotifications({ onOpenReview }: ReviewNotificationsProps) {
  const { isAdmin } = useAuth();
  const { data: pendingCount } = usePendingContentCount();

  if (!isAdmin || !pendingCount || pendingCount === 0) {
    return null;
  }

  return (
    <div className="fixed top-4 left-4 z-50">
      <Button
        onClick={onOpenReview}
        variant="default"
        size="sm"
        className="bg-orange-600 hover:bg-orange-700 shadow-lg"
      >
        <Bell className="h-4 w-4 mr-2" />
        مراجعة مطلوبة
        <Badge variant="secondary" className="ml-2 bg-white text-orange-600">
          {pendingCount}
        </Badge>
      </Button>
    </div>
  );
}

// مكون أيقونة إشعارات بسيط للشريط العلوي
export function ReviewNotificationIcon({ onClick }: { onClick?: () => void }) {
  const { isAdmin } = useAuth();
  const { data: pendingCount } = usePendingContentCount();

  if (!isAdmin) return null;

  return (
    <Button
      onClick={onClick}
      variant="ghost"
      size="sm"
      className="relative"
    >
      <CheckSquare className="h-5 w-5" />
      {pendingCount && pendingCount > 0 && (
        <Badge 
          variant="destructive" 
          className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
        >
          {pendingCount > 99 ? '99+' : pendingCount}
        </Badge>
      )}
    </Button>
  );
}
