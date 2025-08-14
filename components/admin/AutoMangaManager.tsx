import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertCircle, Play, Pause, Settings, Plus, Edit, Trash2, Eye, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { autoMangaService, MangaSource } from '@/services/autoMangaService';
import { schedulerService, ScheduleConfig, SyncJob } from '@/services/schedulerService';
import { useToast } from '@/hooks/use-toast';

export default function AutoMangaManager() {
  const [sources, setSources] = useState<MangaSource[]>([]);
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfig | null>(null);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSource, setSelectedSource] = useState<MangaSource | null>(null);
  const [showSourceDialog, setShowSourceDialog] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
    
    // تحديث دوري للمهام
    const interval = setInterval(loadJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      await Promise.all([
        loadSources(),
        loadScheduleConfig(),
        loadJobs()
      ]);
    } catch (error) {
      console.error('خطأ في تحميل البيانات:', error);
      toast({
        title: 'خطأ',
        description: 'فشل في تحميل البيانات',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadSources = async () => {
    const sourcesData = autoMangaService.getSources();
    setSources(sourcesData);
  };

  const loadScheduleConfig = async () => {
    const config = await schedulerService.getScheduleSettings();
    setScheduleConfig(config);
  };

  const loadJobs = async () => {
    const jobsData = await schedulerService.getJobHistory(10);
    setJobs(jobsData);
  };

  const handleStartManualSync = async (sourceIds?: string[]) => {
    try {
      const jobId = await schedulerService.startManualSync(sourceIds);
      toast({
        title: 'تم بدء المزامنة',
        description: `معرف المهمة: ${jobId}`
      });
      await loadJobs();
    } catch (error) {
      toast({
        title: 'خطأ',
        description: 'فشل في بدء المزامنة',
        variant: 'destructive'
      });
    }
  };

  const handleToggleSource = async (sourceId: string, isActive: boolean) => {
    try {
      await autoMangaService.updateSource(sourceId, { isActive });
      await loadSources();
      toast({
        title: 'تم التحديث',
        description: `تم ${isActive ? 'تفعيل' : 'إلغاء تفعيل'} المصدر`
      });
    } catch (error) {
      toast({
        title: 'خطأ',
        description: 'فشل في تحديث المصدر',
        variant: 'destructive'
      });
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'running':
        return <Clock className="h-4 w-4 text-blue-500 animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      completed: 'default',
      failed: 'destructive',
      running: 'secondary',
      pending: 'outline'
    } as const;

    const labels = {
      completed: 'مكتملة',
      failed: 'فشلت',
      running: 'قيد التشغيل',
      pending: 'في الانتظار'
    };

    return (
      <Badge variant={variants[status as keyof typeof variants] || 'outline'}>
        {labels[status as keyof typeof labels] || status}
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
          <h2 className="text-2xl font-bold">إدارة المانجا التلقائية</h2>
          <p className="text-muted-foreground">إدارة مصادر المانجا والمزامنة التلقائية</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowScheduleDialog(true)} variant="outline">
            <Settings className="h-4 w-4 mr-2" />
            إعدادات الجدولة
          </Button>
          <Button onClick={() => handleStartManualSync()}>
            <Play className="h-4 w-4 mr-2" />
            مزامنة يدوية
          </Button>
        </div>
      </div>

      <Tabs defaultValue="sources" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sources">المصادر</TabsTrigger>
          <TabsTrigger value="jobs">المهام</TabsTrigger>
          <TabsTrigger value="settings">الإعدادات</TabsTrigger>
        </TabsList>

        <TabsContent value="sources" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">مصادر المانجا</h3>
            <Button onClick={() => {
              setSelectedSource(null);
              setShowSourceDialog(true);
            }}>
              <Plus className="h-4 w-4 mr-2" />
              إضافة مصدر
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {sources.map((source) => (
              <Card key={source.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{source.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant={source.type === 'api' ? 'default' : 'secondary'}>
                        {source.type.toUpperCase()}
                      </Badge>
                      <Switch
                        checked={source.isActive}
                        onCheckedChange={(checked) => handleToggleSource(source.id, checked)}
                        size="sm"
                      />
                    </div>
                  </div>
                  <CardDescription className="text-xs">{source.baseUrl}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {source.lastSyncAt && (
                      <p className="text-xs text-muted-foreground">
                        آخر مزامنة: {new Date(source.lastSyncAt).toLocaleString('ar')}
                      </p>
                    )}
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleStartManualSync([source.id])}
                        className="flex-1"
                      >
                        <Play className="h-3 w-3 mr-1" />
                        مزامنة
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedSource(source);
                          setShowSourceDialog(true);
                        }}
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {sources.length === 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                لم يتم إضافة أي مصادر بعد. اضغط على "إضافة مصدر" لبدء الإعداد.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        <TabsContent value="jobs" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">سجل المهام</h3>
            <Button onClick={loadJobs} variant="outline" size="sm">
              تحديث
            </Button>
          </div>

          <div className="space-y-3">
            {jobs.map((job) => (
              <Card key={job.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(job.status)}
                      <div>
                        <p className="font-medium">مهمة المزامنة</p>
                        <p className="text-sm text-muted-foreground">
                          {job.startedAt && new Date(job.startedAt).toLocaleString('ar')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(job.status)}
                    </div>
                  </div>

                  {job.status === 'running' && (
                    <div className="mt-3 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>{job.progress.currentStep}</span>
                        <span>{job.progress.processedManga} مانجا</span>
                      </div>
                      <Progress value={65} className="h-2" />
                    </div>
                  )}

                  {job.result && (
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                      <div className="text-center p-2 bg-green-50 rounded">
                        <p className="font-medium text-green-700">{job.result.newManga}</p>
                        <p className="text-green-600">مانجا جديدة</p>
                      </div>
                      <div className="text-center p-2 bg-blue-50 rounded">
                        <p className="font-medium text-blue-700">{job.result.newChapters}</p>
                        <p className="text-blue-600">فصل جديد</p>
                      </div>
                      <div className="text-center p-2 bg-yellow-50 rounded">
                        <p className="font-medium text-yellow-700">{job.result.duplicatesSkipped}</p>
                        <p className="text-yellow-600">مكرر</p>
                      </div>
                      <div className="text-center p-2 bg-red-50 rounded">
                        <p className="font-medium text-red-700">{job.result.errors.length}</p>
                        <p className="text-red-600">خطأ</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {jobs.length === 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                لا توجد مهام بعد. قم بتشغيل مزامنة يدوية أو انتظر المزامنة المجدولة.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>إعدادات النظام</CardTitle>
              <CardDescription>إعدادات عامة للنظام التلقائي</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label>حد معدل الطلبات (طلب/دقيقة)</Label>
                  <Input type="number" defaultValue="60" min="1" max="300" />
                </div>
                <div>
                  <Label>مهلة انتظار الطلب (ثانية)</Label>
                  <Input type="number" defaultValue="30" min="5" max="120" />
                </div>
              </div>
              
              <div>
                <Label className="flex items-center gap-2">
                  <Switch defaultChecked />
                  تفعيل فحص التكرار
                </Label>
              </div>

              <div>
                <Label className="flex items-center gap-2">
                  <Switch defaultChecked />
                  إرسال إشعارات للمدراء
                </Label>
              </div>

              <Button className="w-full">حفظ الإعدادات</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* حوار إدارة الجدولة */}
      <ScheduleDialog
        open={showScheduleDialog}
        onOpenChange={setShowScheduleDialog}
        scheduleConfig={scheduleConfig}
        onSave={async (config) => {
          try {
            await schedulerService.updateScheduleSettings(config);
            setScheduleConfig(config);
            toast({
              title: 'تم الحفظ',
              description: 'تم حفظ إعدادات الجدولة بنجاح'
            });
            setShowScheduleDialog(false);
          } catch (error) {
            toast({
              title: 'خطأ',
              description: 'فشل في حفظ إعدادات الجدولة',
              variant: 'destructive'
            });
          }
        }}
      />

      {/* حوار إدارة المصدر */}
      <SourceDialog
        open={showSourceDialog}
        onOpenChange={setShowSourceDialog}
        source={selectedSource}
        onSave={async (sourceData) => {
          try {
            if (selectedSource) {
              await autoMangaService.updateSource(selectedSource.id, sourceData);
            } else {
              await autoMangaService.addSource(sourceData);
            }
            await loadSources();
            toast({
              title: 'تم الحفظ',
              description: 'تم حفظ المصد�� بنجاح'
            });
            setShowSourceDialog(false);
          } catch (error) {
            toast({
              title: 'خطأ',
              description: 'فشل في حفظ المصدر',
              variant: 'destructive'
            });
          }
        }}
      />
    </div>
  );
}

// مكون حوار إعدادات الجدولة
function ScheduleDialog({ 
  open, 
  onOpenChange, 
  scheduleConfig, 
  onSave 
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scheduleConfig: ScheduleConfig | null;
  onSave: (config: ScheduleConfig) => void;
}) {
  const [config, setConfig] = useState<ScheduleConfig>({
    enabled: false,
    interval: 'daily',
    time: '02:00'
  });

  useEffect(() => {
    if (scheduleConfig) {
      setConfig(scheduleConfig);
    }
  }, [scheduleConfig]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>إعدادات الجدولة التلقائية</DialogTitle>
          <DialogDescription>
            اضبط مواعيد المزامنة التلقائية للمانجا
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Switch
              checked={config.enabled}
              onCheckedChange={(checked) => setConfig(prev => ({ ...prev, enabled: checked }))}
            />
            <Label>تفعيل الجدولة التلقائية</Label>
          </div>

          {config.enabled && (
            <>
              <div>
                <Label>التكرار</Label>
                <Select 
                  value={config.interval} 
                  onValueChange={(value: any) => setConfig(prev => ({ ...prev, interval: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">كل ساعة</SelectItem>
                    <SelectItem value="daily">يومياً</SelectItem>
                    <SelectItem value="weekly">أسبوعياً</SelectItem>
                    <SelectItem value="custom">مخصص</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(config.interval === 'daily' || config.interval === 'weekly') && (
                <div>
                  <Label>الوقت</Label>
                  <Input
                    type="time"
                    value={config.time || '02:00'}
                    onChange={(e) => setConfig(prev => ({ ...prev, time: e.target.value }))}
                  />
                </div>
              )}

              {config.interval === 'weekly' && (
                <div>
                  <Label>يوم الأسبوع</Label>
                  <Select 
                    value={config.dayOfWeek?.toString() || '0'} 
                    onValueChange={(value) => setConfig(prev => ({ ...prev, dayOfWeek: parseInt(value) }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">الأحد</SelectItem>
                      <SelectItem value="1">الإثنين</SelectItem>
                      <SelectItem value="2">الثلاثاء</SelectItem>
                      <SelectItem value="3">الأربعاء</SelectItem>
                      <SelectItem value="4">الخميس</SelectItem>
                      <SelectItem value="5">الجمعة</SelectItem>
                      <SelectItem value="6">السبت</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {config.interval === 'custom' && (
                <div>
                  <Label>الفاصل الزمني (دقائق)</Label>
                  <Input
                    type="number"
                    min="5"
                    max="1440"
                    value={config.customInterval || 60}
                    onChange={(e) => setConfig(prev => ({ ...prev, customInterval: parseInt(e.target.value) }))}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={() => onSave(config)}>
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// مكون حوار إدارة المصدر
function SourceDialog({ 
  open, 
  onOpenChange, 
  source, 
  onSave 
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: MangaSource | null;
  onSave: (source: Omit<MangaSource, 'id'>) => void;
}) {
  const [formData, setFormData] = useState({
    name: '',
    baseUrl: '',
    type: 'api' as 'api' | 'scraping',
    isActive: true,
    config: {
      apiKey: '',
      rateLimit: 60
    }
  });

  useEffect(() => {
    if (source) {
      setFormData({
        name: source.name,
        baseUrl: source.baseUrl,
        type: source.type,
        isActive: source.isActive,
        config: source.config
      });
    } else {
      setFormData({
        name: '',
        baseUrl: '',
        type: 'api',
        isActive: true,
        config: {
          apiKey: '',
          rateLimit: 60
        }
      });
    }
  }, [source]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{source ? 'تعديل المصدر' : 'إضافة مصدر جديد'}</DialogTitle>
          <DialogDescription>
            أدخل تفاصيل مصدر المانجا
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>اسم المصدر</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="مثال: MangaDex"
            />
          </div>

          <div>
            <Label>الرابط الأساسي</Label>
            <Input
              value={formData.baseUrl}
              onChange={(e) => setFormData(prev => ({ ...prev, baseUrl: e.target.value }))}
              placeholder="https://api.mangadex.org"
            />
          </div>

          <div>
            <Label>نوع المصدر</Label>
            <Select 
              value={formData.type} 
              onValueChange={(value: any) => setFormData(prev => ({ ...prev, type: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="api">API</SelectItem>
                <SelectItem value="scraping">Web Scraping</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {formData.type === 'api' && (
            <>
              <div>
                <Label>مفتاح API (اختياري)</Label>
                <Input
                  type="password"
                  value={formData.config.apiKey || ''}
                  onChange={(e) => setFormData(prev => ({ 
                    ...prev, 
                    config: { ...prev.config, apiKey: e.target.value }
                  }))}
                />
              </div>

              <div>
                <Label>حد معدل الطلبات (طلب/دقيقة)</Label>
                <Input
                  type="number"
                  min="1"
                  max="300"
                  value={formData.config.rateLimit || 60}
                  onChange={(e) => setFormData(prev => ({ 
                    ...prev, 
                    config: { ...prev.config, rateLimit: parseInt(e.target.value) }
                  }))}
                />
              </div>
            </>
          )}

          <div className="flex items-center gap-2">
            <Switch
              checked={formData.isActive}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isActive: checked }))}
            />
            <Label>مصدر نشط</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={() => onSave(formData)}>
            {source ? 'حفظ التغييرات' : 'إضافة المصدر'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
