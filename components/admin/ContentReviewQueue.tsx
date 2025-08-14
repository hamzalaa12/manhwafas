import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, Check, X, Eye, Clock, BookOpen, FileText, Star } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

interface ReviewQueueItem {
  id: string;
  content_type: 'manga' | 'chapter';
  content_id: string;
  manga_id?: string;
  title: string;
  description?: string;
  priority: number;
  auto_added_by?: string;
  submitted_at: string;
  status: 'pending' | 'approved' | 'rejected';
  manga_details?: {
    author?: string;
    artist?: string;
    genre?: string[];
    cover_image_url?: string;
    manga_type: 'manga' | 'manhwa' | 'manhua';
  };
  chapter_details?: {
    chapter_number: number;
    pages?: any[];
    manga_title?: string;
  };
}

interface ReviewStats {
  pending_manga: number;
  pending_chapters: number;
  total_pending: number;
  approved_today: number;
  rejected_today: number;
  oldest_pending_days: number;
}

export default function ContentReviewQueue() {
  const [reviewItems, setReviewItems] = useState<ReviewQueueItem[]>([]);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<ReviewQueueItem | null>(null);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject'>('approve');
  const [filter, setFilter] = useState<'all' | 'manga' | 'chapter'>('all');
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    loadData();
    
    // تحديث دوري كل 30 ثانية
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      await Promise.all([
        loadReviewQueue(),
        loadStats()
      ]);
    } catch (error) {
      console.error('خطأ في تحميل البيانات:', error);
      toast({
        title: 'خطأ',
        description: 'فشل في تحميل بيانات المراجعة',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadReviewQueue = async () => {
    const { data, error } = await supabase
      .from('content_review_queue')
      .select(`
        *,
        manga:manga!content_review_queue_content_id_fkey(
          author, artist, genre, cover_image_url, manga_type
        ),
        chapter:chapters!content_review_queue_content_id_fkey(
          chapter_number, pages,
          manga:manga(title)
        )
      `)
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('submitted_at', { ascending: true });

    if (error) {
      console.error('خطأ في تحميل قائمة المراجعة:', error);
      return;
    }

    const processedItems: ReviewQueueItem[] = data?.map(item => ({
      ...item,
      manga_details: item.content_type === 'manga' ? item.manga : undefined,
      chapter_details: item.content_type === 'chapter' ? {
        chapter_number: item.chapter?.chapter_number,
        pages: item.chapter?.pages,
        manga_title: item.chapter?.manga?.title
      } : undefined
    })) || [];

    setReviewItems(processedItems);
  };

  const loadStats = async () => {
    const { data, error } = await supabase
      .rpc('get_review_queue_stats');

    if (error) {
      console.error('خطأ في تحميل الإحصائيات:', error);
      return;
    }

    if (data && data.length > 0) {
      setStats(data[0]);
    }
  };

  const handleReview = async (action: 'approve' | 'reject') => {
    if (!selectedItem || !user) return;

    try {
      const { error } = await supabase
        .rpc(action === 'approve' ? 'approve_content' : 'reject_content', {
          p_queue_id: selectedItem.id,
          p_reviewer_id: user.id,
          p_notes: reviewNotes || null
        });

      if (error) throw error;

      toast({
        title: action === 'approve' ? 'تمت الم��افقة' : 'تم الرفض',
        description: `تم ${action === 'approve' ? 'الموافقة على' : 'رفض'} ${selectedItem.content_type === 'manga' ? 'المانجا' : 'الفصل'}: ${selectedItem.title}`
      });

      // تحديث القائمة
      await loadData();
      
      // إغلاق الحوار
      setShowReviewDialog(false);
      setSelectedItem(null);
      setReviewNotes('');

    } catch (error) {
      console.error('خطأ في المراجعة:', error);
      toast({
        title: 'خطأ',
        description: 'فشل في معالجة المراجعة',
        variant: 'destructive'
      });
    }
  };

  const openReviewDialog = (item: ReviewQueueItem, action: 'approve' | 'reject') => {
    setSelectedItem(item);
    setReviewAction(action);
    setReviewNotes('');
    setShowReviewDialog(true);
  };

  const filteredItems = reviewItems.filter(item => {
    if (filter === 'all') return true;
    return item.content_type === filter;
  });

  const getContentTypeIcon = (type: 'manga' | 'chapter') => {
    return type === 'manga' ? <BookOpen className="h-4 w-4" /> : <FileText className="h-4 w-4" />;
  };

  const getPriorityBadge = (priority: number) => {
    if (priority > 0) {
      return <Badge variant="destructive"><Star className="h-3 w-3 mr-1" />عالية</Badge>;
    }
    return <Badge variant="outline">عادية</Badge>;
  };

  const getMangaTypeBadge = (type: string) => {
    const colors = {
      manga: 'bg-blue-100 text-blue-800',
      manhwa: 'bg-green-100 text-green-800', 
      manhua: 'bg-purple-100 text-purple-800'
    };
    
    return (
      <Badge variant="outline" className={colors[type as keyof typeof colors]}>
        {type.toUpperCase()}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Clock className="h-8 w-8 animate-spin mx-auto mb-2" />
          <p>جاري التحميل...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">مراجعة المحتوى</h2>
          <p className="text-muted-foreground">مراجعة والموافقة على المحتوى المضاف تلقائياً</p>
        </div>
        <Button onClick={loadData} variant="outline">
          تحديث
        </Button>
      </div>

      {/* إحصائيات سريعة */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>في انتظار المراجعة</CardDescription>
              <div className="text-2xl font-bold text-orange-600">{stats.total_pending}</div>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>مانجا معلقة</CardDescription>
              <div className="text-2xl font-bold text-blue-600">{stats.pending_manga}</div>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>فصول معلقة</CardDescription>
              <div className="text-2xl font-bold text-green-600">{stats.pending_chapters}</div>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>أقدم عنصر معلق</CardDescription>
              <div className="text-2xl font-bold text-red-600">{stats.oldest_pending_days} يوم</div>
            </CardHeader>
          </Card>
        </div>
      )}

      {/* فلاتر */}
      <Tabs value={filter} onValueChange={(value) => setFilter(value as any)} className="w-full">
        <TabsList>
          <TabsTrigger value="all">الكل ({reviewItems.length})</TabsTrigger>
          <TabsTrigger value="manga">
            مانجا ({reviewItems.filter(i => i.content_type === 'manga').length})
          </TabsTrigger>
          <TabsTrigger value="chapter">
            فصول ({reviewItems.filter(i => i.content_type === 'chapter').length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={filter} className="mt-4">
          {filteredItems.length === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {filter === 'all' 
                  ? 'لا توجد عناصر في انتظار المراجعة' 
                  : `لا توجد ${filter === 'manga' ? 'مانجا' : 'فصول'} في انتظار المراجعة`
                }
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-4">
              {filteredItems.map((item) => (
                <Card key={item.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 space-y-3">
                        <div className="flex items-center gap-2">
                          {getContentTypeIcon(item.content_type)}
                          <h3 className="font-medium">{item.title}</h3>
                          {getPriorityBadge(item.priority)}
                          {item.manga_details && getMangaTypeBadge(item.manga_details.manga_type)}
                        </div>

                        {item.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {item.description}
                          </p>
                        )}

                        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                          <span>تاريخ الإضافة: {new Date(item.submitted_at).toLocaleDateString('ar')}</span>
                          {item.auto_added_by && (
                            <span>المصدر: {item.auto_added_by}</span>
                          )}
                          {item.manga_details?.author && (
                            <span>المؤلف: {item.manga_details.author}</span>
                          )}
                          {item.chapter_details && (
                            <span>
                              الفصل {item.chapter_details.chapter_number} من {item.chapter_details.manga_title}
                            </span>
                          )}
                        </div>

                        {item.manga_details?.genre && item.manga_details.genre.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {item.manga_details.genre.slice(0, 3).map((genre, index) => (
                              <Badge key={index} variant="secondary" className="text-xs">
                                {genre}
                              </Badge>
                            ))}
                            {item.manga_details.genre.length > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{item.manga_details.genre.length - 3}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 ml-4">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            // فتح نافذة عرض تفاصيل المحتوى
                            window.open(
                              item.content_type === 'manga' 
                                ? `/manga/${item.content_id}` 
                                : `/manga/${item.manga_id}/chapter/${item.chapter_details?.chapter_number}`,
                              '_blank'
                            );
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => openReviewDialog(item, 'approve')}
                        >
                          <Check className="h-4 w-4 mr-1" />
                          موافقة
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => openReviewDialog(item, 'reject')}
                        >
                          <X className="h-4 w-4 mr-1" />
                          رفض
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* حوار المراجعة */}
      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reviewAction === 'approve' ? 'موافقة على المحتوى' : 'رفض المحتوى'}
            </DialogTitle>
            <DialogDescription>
              {selectedItem && (
                <>
                  هل أنت متأكد من {reviewAction === 'approve' ? 'الموافقة على' : 'رفض'}{' '}
                  {selectedItem.content_type === 'manga' ? 'المانجا' : 'الفصل'}: {selectedItem.title}؟
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                ملاحظات المراجعة {reviewAction === 'reject' ? '(مطلوبة)' : '(اختيارية)'}
              </label>
              <Textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder={
                  reviewAction === 'approve' 
                    ? 'أي ملاحظات إضافية...'
                    : 'يرجى توضيح سبب الرفض...'
                }
                className="mt-1"
                rows={3}
              />
            </div>

            {reviewAction === 'approve' && (
              <Alert>
                <Check className="h-4 w-4" />
                <AlertDescription>
                  سيتم نشر هذا المحتوى ليراه جميع المستخدمين.
                </AlertDescription>
              </Alert>
            )}

            {reviewAction === 'reject' && (
              <Alert variant="destructive">
                <X className="h-4 w-4" />
                <AlertDescription>
                  سيتم إخفاء هذا المحتوى ولن يظهر للمستخدمين.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReviewDialog(false)}>
              إلغاء
            </Button>
            <Button
              variant={reviewAction === 'approve' ? 'default' : 'destructive'}
              onClick={() => handleReview(reviewAction)}
              disabled={reviewAction === 'reject' && !reviewNotes.trim()}
            >
              {reviewAction === 'approve' ? 'موافقة' : 'رفض'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
