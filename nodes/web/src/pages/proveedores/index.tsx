import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  Building,
  Plus,
  Mail,
  Phone,
  MapPin,
  Star,
  Sparkles,
  ShoppingBag,
  MessageSquare,
  Loader2,
  DollarSign,
  Info,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { EmptyState, LoadingState } from '@/components/ui/states';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  listProviders,
  getProviderById,
  createProvider,
  addProviderProduct,
  submitProviderRating,
  cleanProviderDataWithIA,
  type ProviderView,
  type ProviderProductView,
  type ProviderRatingView,
} from '@/lib/api';

export default function ProveedoresPage(): ReactNode {
  // Lists
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [providerDetail, setProviderDetail] = useState<{
    provider: ProviderView;
    products: ProviderProductView[];
    ratings: ProviderRatingView[];
  } | null>(null);

  // States
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Forms
  const [showCreateProvider, setShowCreateProvider] = useState(false);
  const [pName, setPName] = useState('');
  const [pRut, setPRut] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pAddress, setPAddress] = useState('');
  const [creatingP, setCreatingP] = useState(false);

  // Catalog Product Form
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [prodName, setProdName] = useState('');
  const [prodDesc, setProdDesc] = useState('');
  const [prodPrice, setProdPrice] = useState<number>(0);
  const [prodUnit, setProdUnit] = useState('unidades');
  const [addingProduct, setAddingProduct] = useState(false);

  // Rating Form
  const [showAddRating, setShowAddRating] = useState(false);
  const [ratingScore, setRatingScore] = useState<number>(5);
  const [ratingComment, setRatingComment] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);

  // AI Assistant Modal
  const [showAiCleaner, setShowAiCleaner] = useState(false);
  const [aiRawText, setAiRawText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiCleanedData, setAiCleanedData] = useState<{
    name: string;
    rut?: string;
    email?: string;
    phone?: string;
    address?: string;
    products: Array<{ name: string; description?: string; price?: number; unit?: string }>;
  } | null>(null);
  const [savingAiData, setSavingAiData] = useState(false);

  // Fetch Providers List
  const fetchProviders = useCallback(async () => {
    setLoadingList(true);
    setErrorMsg(null);
    try {
      const data = await listProviders();
      setProviders(data);
      if (data.length > 0 && !selectedProviderId && data[0]) {
        setSelectedProviderId(data[0].id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al cargar proveedores');
    } finally {
      setLoadingList(false);
    }
  }, [selectedProviderId]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  // Fetch Provider details (catalog and ratings)
  const fetchProviderDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setErrorMsg(null);
    try {
      const detail = await getProviderById(id);
      setProviderDetail(detail);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al cargar detalles del proveedor');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedProviderId) {
      fetchProviderDetail(selectedProviderId);
    }
  }, [selectedProviderId, fetchProviderDetail]);

  // Create Provider action
  const handleCreateProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pName) {
      setErrorMsg('El nombre es obligatorio.');
      return;
    }
    setCreatingP(true);
    setErrorMsg(null);
    try {
      const newP = await createProvider({
        name: pName,
        rut: pRut || undefined,
        email: pEmail || undefined,
        phone: pPhone || undefined,
        address: pAddress || undefined,
      });
      setProviders((prev) => [...prev, newP]);
      setSelectedProviderId(newP.id);
      setShowCreateProvider(false);
      setPName('');
      setPRut('');
      setPEmail('');
      setPPhone('');
      setPAddress('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al crear proveedor');
    } finally {
      setCreatingP(false);
    }
  };

  // Add Product to Catalog action
  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProviderId) return;
    if (!prodName) {
      setErrorMsg('El nombre del producto es obligatorio.');
      return;
    }
    setAddingProduct(true);
    setErrorMsg(null);
    try {
      await addProviderProduct(selectedProviderId, {
        name: prodName,
        description: prodDesc || undefined,
        price: prodPrice > 0 ? prodPrice : undefined,
        unit: prodUnit || undefined,
      });
      await fetchProviderDetail(selectedProviderId);
      setShowAddProduct(false);
      setProdName('');
      setProdDesc('');
      setProdPrice(0);
      setProdUnit('unidades');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al añadir producto');
    } finally {
      setAddingProduct(false);
    }
  };

  // Submit Rating action
  const handleSubmitRating = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProviderId) return;
    setSubmittingRating(true);
    setErrorMsg(null);
    try {
      await submitProviderRating(selectedProviderId, {
        score: ratingScore,
        comment: ratingComment || undefined,
      });
      // Refresh details and update provider list score
      const updatedDetail = await getProviderById(selectedProviderId);
      setProviderDetail(updatedDetail);
      setProviders((prev) =>
        prev.map((p) =>
          p.id === selectedProviderId
            ? { ...p, score: updatedDetail.provider.score }
            : p
        )
      );
      setShowAddRating(false);
      setRatingScore(5);
      setRatingComment('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al registrar valoración');
    } finally {
      setSubmittingRating(false);
    }
  };

  // Limpieza de datos vía IA (NVIDIA NIM en el backend)
  const handleCleanData = async () => {
    if (!aiRawText.trim()) {
      setErrorMsg('Escribe o pega algún texto desordenado primero.');
      return;
    }
    setAiLoading(true);
    setErrorMsg(null);
    try {
      const data = await cleanProviderDataWithIA({ rawData: aiRawText });
      setAiCleanedData(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al procesar datos con IA');
    } finally {
      setAiLoading(false);
    }
  };

  // Save parsed AI details and products
  const handleSaveAiData = async () => {
    if (!aiCleanedData) return;
    setSavingAiData(true);
    setErrorMsg(null);
    try {
      // 1. Create the provider
      const provider = await createProvider({
        name: aiCleanedData.name,
        rut: aiCleanedData.rut || undefined,
        email: aiCleanedData.email || undefined,
        phone: aiCleanedData.phone || undefined,
        address: aiCleanedData.address || undefined,
      });

      // 2. Add products one by one (or batch if supported, addProviderProduct is sequential here)
      for (const prod of aiCleanedData.products) {
        await addProviderProduct(provider.id, {
          name: prod.name,
          description: prod.description || undefined,
          price: prod.price || undefined,
          unit: prod.unit || undefined,
        });
      }

      // 3. Update local state
      setProviders((prev) => [...prev, provider]);
      setSelectedProviderId(provider.id);
      setShowAiCleaner(false);
      setAiRawText('');
      setAiCleanedData(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al guardar los datos procesados.');
    } finally {
      setSavingAiData(false);
    }
  };

  // Render Rating Stars
  const renderStars = (score: number, size = 4) => {
    const rounded = Math.round(score);
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`size-${size} ${
              star <= rounded
                ? 'text-yellow-500 fill-yellow-500'
                : 'text-muted-foreground/40'
            }`}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {errorMsg && (
        <Alert variant="destructive" live>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <p className="font-semibold">Ha ocurrido un problema</p>
              <p className="mt-1">{errorMsg}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setErrorMsg(null)} className="h-auto p-1">
              Descartar
            </Button>
          </div>
        </Alert>
      )}

      {/* Main Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left column: List of Providers */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          <Card className="border border-border/60 shadow-sm backdrop-blur bg-card/60">
            <CardHeader className="pb-3">
              <div className="flex justify-between items-center">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <Building className="size-5 text-primary" />
                  Proveedores
                </CardTitle>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8 rounded-full"
                  onClick={() => setShowCreateProvider(!showCreateProvider)}
                  title="Nuevo Proveedor"
                >
                  <Plus className="size-4" />
                </Button>
              </div>
              <CardDescription>Catálogo de proveedores homologados y sus valoraciones.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {/* AI data cleaner helper banner */}
              <button
                onClick={() => setShowAiCleaner(true)}
                className="w-full rounded-xl bg-gradient-to-r from-violet-600/10 to-indigo-600/10 hover:from-violet-600/15 hover:to-indigo-600/15 border border-indigo-500/20 hover:border-indigo-500/35 p-3.5 transition-all text-left flex items-center gap-3 group"
              >
                <div className="size-8 rounded-lg bg-indigo-600/20 flex items-center justify-center text-indigo-600">
                  <Sparkles className="size-4 animate-pulse" />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-bold text-indigo-600 uppercase tracking-wide">Limpieza con IA</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 group-hover:text-foreground/90 transition-colors">
                    Pega texto sucio para crear un catálogo en segundos.
                  </p>
                </div>
              </button>

              {showCreateProvider && (
                <form onSubmit={handleCreateProvider} className="border border-border/80 rounded-lg p-3 bg-muted/30 flex flex-col gap-2 mb-2">
                  <p className="text-xs font-semibold text-primary uppercase">Nuevo Proveedor</p>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="pName" className="text-[11px]">Nombre / Razón Social *</Label>
                    <Input
                      id="pName"
                      placeholder="Ferretería Industrial Ltda."
                      value={pName}
                      onChange={(e) => setPName(e.target.value)}
                      className="h-8 text-xs"
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="pRut" className="text-[11px]">RUT (opcional)</Label>
                    <Input
                      id="pRut"
                      placeholder="77.654.321-K"
                      value={pRut}
                      onChange={(e) => setPRut(e.target.value)}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="pEmail" className="text-[11px]">Correo</Label>
                    <Input
                      id="pEmail"
                      placeholder="contacto@ferreind.cl"
                      type="email"
                      value={pEmail}
                      onChange={(e) => setPEmail(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="pPhone" className="text-[11px]">Teléfono</Label>
                    <Input
                      id="pPhone"
                      placeholder="+56912345678"
                      value={pPhone}
                      onChange={(e) => setPPhone(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="pAddress" className="text-[11px]">Dirección</Label>
                    <Input
                      id="pAddress"
                      placeholder="Av. Las Condes 10200"
                      value={pAddress}
                      onChange={(e) => setPAddress(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex gap-2 justify-end mt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setShowCreateProvider(false)}
                      disabled={creatingP}
                    >
                      Cancelar
                    </Button>
                    <Button type="submit" size="sm" className="h-7 text-xs bg-primary text-primary-foreground" disabled={creatingP}>
                      {creatingP ? 'Guardando...' : 'Crear'}
                    </Button>
                  </div>
                </form>
              )}

              {loadingList ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : providers.length === 0 ? (
                <div className="text-center py-6 text-xs text-muted-foreground">
                  No hay proveedores creados. Crea uno con el botón +.
                </div>
              ) : (
                <div className="flex flex-col gap-1.5 max-h-[400px] overflow-y-auto pr-1">
                  {providers.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedProviderId(p.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-all flex flex-col gap-1.5 ${
                        selectedProviderId === p.id
                          ? 'border-primary/50 bg-primary/5 shadow-sm'
                          : 'border-border/60 hover:border-border/100 hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex justify-between items-start w-full">
                        <span className="font-bold text-xs truncate max-w-[130px] text-foreground">{p.name}</span>
                        {p.rut && (
                          <Badge variant="outline" className="font-mono text-[9px] px-1 py-0 border-muted-foreground/30 text-muted-foreground bg-muted/10">
                            {p.rut}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {renderStars(p.score, 3)}
                        <span className="text-[10px] font-bold text-foreground/80 font-mono">({p.score.toFixed(1)})</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: Selected Provider Catalog & Rating History */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          {selectedProviderId && providerDetail ? (
            <>
              {/* Provider Identity Header Card */}
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-muted/20 border border-border/65 rounded-xl p-5 backdrop-blur">
                <div className="flex items-start gap-4">
                  <div className="size-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0 mt-1">
                    <Building className="size-7" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <h2 className="text-xl font-bold text-foreground flex items-center gap-2 flex-wrap">
                      {providerDetail.provider.name}
                      {providerDetail.provider.rut && (
                        <Badge variant="outline" className="font-mono text-xs border-primary/30 text-primary bg-primary/5">
                          {providerDetail.provider.rut}
                        </Badge>
                      )}
                    </h2>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1">
                      {providerDetail.provider.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="size-3.5 text-muted-foreground/70" />
                          {providerDetail.provider.email}
                        </span>
                      )}
                      {providerDetail.provider.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="size-3.5 text-muted-foreground/70" />
                          {providerDetail.provider.phone}
                        </span>
                      )}
                      {providerDetail.provider.address && (
                        <span className="flex items-center gap-1">
                          <MapPin className="size-3.5 text-muted-foreground/70" />
                          {providerDetail.provider.address}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1.5 shrink-0 bg-background/50 border rounded-lg px-4 py-2">
                  <div className="flex items-center gap-1.5">
                    {renderStars(providerDetail.provider.score, 4)}
                    <span className="text-sm font-bold font-mono">({providerDetail.provider.score.toFixed(1)})</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Calificación Promedio</span>
                </div>
              </div>

              {/* Catalog section and Rating review history split */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Catalog (Left 2 columns equivalent) */}
                <Card className="xl:col-span-2 border border-border/60 shadow-sm bg-card/70 flex flex-col">
                  <CardHeader className="pb-3 flex flex-row justify-between items-center">
                    <div>
                      <CardTitle className="text-md font-bold flex items-center gap-2">
                        <ShoppingBag className="size-4 text-primary" />
                        Catálogo de Productos y Servicios
                      </CardTitle>
                      <CardDescription>Productos catalogados con precios unitarios.</CardDescription>
                    </div>

                    <Button variant="outline" size="sm" onClick={() => setShowAddProduct(true)} className="flex items-center gap-1.5 text-xs">
                      <Plus className="size-4" />
                      Agregar Producto
                    </Button>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-x-auto">
                    {showAddProduct && (
                      <form onSubmit={handleAddProduct} className="border border-border/80 rounded-lg p-4 bg-muted/40 flex flex-col gap-3 mb-4">
                        <div className="flex justify-between items-center pb-1 border-b border-border">
                          <span className="text-xs font-bold text-primary uppercase">Nuevo Producto o Servicio</span>
                          <button type="button" className="text-xs text-muted-foreground" onClick={() => setShowAddProduct(false)}>X</button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <Label htmlFor="prodName" className="text-[11px]">Nombre del Producto *</Label>
                            <Input
                              id="prodName"
                              placeholder="Ej: Pala de Punta"
                              value={prodName}
                              onChange={(e) => setProdName(e.target.value)}
                              className="h-8 text-xs"
                              required
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <Label htmlFor="prodUnit" className="text-[11px]">Unidad de Medida</Label>
                            <Input
                              id="prodUnit"
                              placeholder="Ej: unidades / sacos / global"
                              value={prodUnit}
                              onChange={(e) => setProdUnit(e.target.value)}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <Label htmlFor="prodPrice" className="text-[11px]">Precio Unitario (CLP sin decimales)</Label>
                            <div className="relative">
                              <Input
                                id="prodPrice"
                                type="number"
                                placeholder="0"
                                value={prodPrice === 0 ? '' : prodPrice}
                                onChange={(e) => setProdPrice(parseInt(e.target.value, 10) || 0)}
                                className="h-8 text-xs pl-6"
                              />
                              <DollarSign className="absolute left-2 top-2.5 size-3 text-muted-foreground/60" />
                            </div>
                          </div>
                          <div className="flex flex-col gap-1">
                            <Label htmlFor="prodDesc" className="text-[11px]">Descripción (opcional)</Label>
                            <Input
                              id="prodDesc"
                              placeholder="Ej: Pala mango madera reforzado"
                              value={prodDesc}
                              onChange={(e) => setProdDesc(e.target.value)}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end mt-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowAddProduct(false)}
                            disabled={addingProduct}
                          >
                            Cancelar
                          </Button>
                          <Button type="submit" size="sm" className="bg-primary text-primary-foreground" disabled={addingProduct}>
                            {addingProduct ? 'Añadiendo...' : 'Añadir al Catálogo'}
                          </Button>
                        </div>
                      </form>
                    )}

                    {loadingDetail ? (
                      <LoadingState label="Cargando catálogo…" />
                    ) : providerDetail.products.length === 0 ? (
                      <EmptyState
                        icon={ShoppingBag}
                        title="No hay productos en el catálogo"
                        message="Crea productos manualmente o usa la Limpieza con IA."
                      />
                    ) : (
                      <div className="max-h-[350px] overflow-y-auto rounded-md border border-border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Nombre</TableHead>
                              <TableHead>Descripción</TableHead>
                              <TableHead className="text-right">Precio</TableHead>
                              <TableHead className="text-right">Unidad</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {providerDetail.products.map((prod) => (
                              <TableRow key={prod.id} className="hover:bg-muted/30">
                                <TableCell className="font-bold text-xs">{prod.name}</TableCell>
                                <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={prod.description || ''}>
                                  {prod.description || '—'}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs font-bold text-foreground">
                                  {prod.price ? `$${prod.price.toLocaleString('es-CL')}` : '—'}
                                </TableCell>
                                <TableCell className="text-right text-xs text-muted-foreground">{prod.unit || '—'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Ratings & Comments (Right column) */}
                <Card className="xl:col-span-1 border border-border/60 shadow-sm bg-card/70 flex flex-col">
                  <CardHeader className="pb-3 flex flex-row justify-between items-center">
                    <div>
                      <CardTitle className="text-md font-bold flex items-center gap-2">
                        <MessageSquare className="size-4 text-primary" />
                        Calificaciones
                      </CardTitle>
                      <CardDescription>Reseñas de desempeño comercial.</CardDescription>
                    </div>

                    <Button variant="outline" size="sm" onClick={() => setShowAddRating(true)} className="flex items-center gap-1 text-xs">
                      <Star className="size-3.5" />
                      Evaluar
                    </Button>
                  </CardHeader>
                  <CardContent className="flex-1">
                    {showAddRating && (
                      <form onSubmit={handleSubmitRating} className="border border-border/80 rounded-lg p-3 bg-muted/40 flex flex-col gap-3 mb-4">
                        <div className="flex justify-between items-center pb-1 border-b border-border">
                          <span className="text-[11px] font-bold text-primary uppercase">Evaluar Proveedor</span>
                          <button
                            type="button"
                            aria-label="Cerrar"
                            className="text-muted-foreground hover:text-foreground rounded focus-visible:ring-2 focus-visible:ring-ring focus:outline-none"
                            onClick={() => setShowAddRating(false)}
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label className="text-[11px]">Puntuación (1 a 5 estrellas)</Label>
                          <div className="flex gap-2 items-center" role="radiogroup" aria-label="Puntuación">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button
                                key={star}
                                type="button"
                                role="radio"
                                aria-checked={star === ratingScore}
                                aria-label={`${star} estrellas`}
                                onClick={() => setRatingScore(star)}
                                className="rounded focus-visible:ring-2 focus-visible:ring-ring focus:outline-none"
                              >
                                <Star
                                  className={`size-6 ${
                                    star <= ratingScore
                                      ? 'text-yellow-500 fill-yellow-500'
                                      : 'text-muted-foreground/30 hover:text-yellow-500/50'
                                  }`}
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label htmlFor="ratingComment" className="text-[11px]">Comentario / Feedback</Label>
                          <Input
                            id="ratingComment"
                            placeholder="Describa tiempos de entrega, calidad..."
                            value={ratingComment}
                            onChange={(e) => setRatingComment(e.target.value)}
                            className="text-xs"
                          />
                        </div>
                        <div className="flex gap-2 justify-end mt-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowAddRating(false)}
                            disabled={submittingRating}
                          >
                            Cancelar
                          </Button>
                          <Button type="submit" size="sm" className="bg-primary text-primary-foreground" disabled={submittingRating}>
                            {submittingRating ? 'Guardando...' : 'Guardar'}
                          </Button>
                        </div>
                      </form>
                    )}

                    {loadingDetail ? (
                      <LoadingState rows={3} label="Cargando calificaciones…" />
                    ) : providerDetail.ratings.length === 0 ? (
                      <EmptyState message='Aún no cuenta con evaluaciones. Haz clic en "Evaluar" para agregar una.' />
                    ) : (
                      <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto pr-1">
                        {providerDetail.ratings.map((rate) => (
                          <div key={rate.id} className="border border-border/60 rounded-lg p-3 bg-muted/20 flex flex-col gap-1.5">
                            <div className="flex justify-between items-center">
                              <span className="text-[11px] font-bold text-foreground/80">
                                {rate.actor ? `${rate.actor.firstName} ${rate.actor.lastName}` : 'Colaborador'}
                              </span>
                              <span className="text-[9px] text-muted-foreground">
                                {new Date(rate.createdAt).toLocaleDateString('es-CL')}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              {renderStars(rate.score, 3.5)}
                              <Badge className="font-mono text-[9px] h-4" variant="secondary">Score {rate.score}</Badge>
                            </div>
                            {rate.comment && (
                              <p className="text-[11px] text-muted-foreground/90 bg-muted/40 p-2 rounded border border-border/40 italic">
                                "{rate.comment}"
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-32 border border-dashed rounded-lg border-border bg-card/40">
              <Building className="size-16 text-muted-foreground/40" />
              <h3 className="text-md font-bold text-muted-foreground/80 mt-4">No has seleccionado ningún proveedor</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm text-center">
                Selecciona un proveedor en el menú lateral para ver su catálogo, reseñas comerciales, calificarlo o usar el limpiador con IA.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* AI Assistant Data Cleaner Modal */}
      {showAiCleaner && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-3xl w-full max-h-[90dvh] overflow-hidden flex flex-col">
            <div className="p-5 border-b border-border flex justify-between items-center">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Sparkles className="size-5 text-indigo-500" />
                Asistente de Limpieza de Proveedores con IA
              </h3>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-full"
                onClick={() => {
                  setShowAiCleaner(false);
                  setAiCleanedData(null);
                  setAiRawText('');
                }}
              >
                X
              </Button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-4">
              {/* Info banner */}
              <div className="flex items-start gap-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs text-indigo-700 dark:text-indigo-400">
                <Info className="size-4 shrink-0 mt-0.5" />
                <div className="flex-1">
                  Pega un correo, un fragmento de texto o una lista desordenada de precios. La IA
                  extraerá el nombre, contacto y estructurará el catálogo del proveedor
                  automáticamente.
                </div>
              </div>

              {!aiCleanedData ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="aiRawText">Copiar y pegar texto crudo/sin formato:</Label>
                  <Textarea
                    id="aiRawText"
                    rows={8}
                    placeholder={`Ejemplo:
Ferretería Maipú, contacto ventas@ferremaipu.cl. Fono +56922334455.
Lista de precios actualizados para GMT:
- Pala de acero a $15.000 la unidad.
- Sacos de Cemento de 25 kg a $5.500 el saco.
- Set de herramientas manuales por $45.000 global.`}
                    value={aiRawText}
                    onChange={(e) => setAiRawText(e.target.value)}
                    className="text-xs font-mono"
                  />
                  <Button
                    type="button"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2 mt-2 flex items-center justify-center gap-2"
                    onClick={handleCleanData}
                    disabled={aiLoading || !aiRawText.trim()}
                  >
                    {aiLoading ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Analizando con IA...
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-4" />
                        Estructurar con IA
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                /* Display Extracted Clean Data */
                <div className="flex flex-col gap-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-emerald-500 uppercase tracking-wide flex items-center gap-1">
                      <Sparkles className="size-4 animate-bounce" /> Datos Extraídos con Éxito
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px]"
                      onClick={() => setAiCleanedData(null)}
                    >
                      Volver a empezar
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border rounded-xl p-4 bg-muted/20">
                    <div className="flex flex-col gap-3">
                      <p className="text-xs font-bold text-primary uppercase">Metadatos del Proveedor</p>
                      <div className="flex flex-col gap-1">
                        <Label className="text-[10px]">Nombre</Label>
                        <Input
                          value={aiCleanedData.name}
                          onChange={(e) => setAiCleanedData({ ...aiCleanedData, name: e.target.value })}
                          className="h-8 text-xs font-semibold"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label className="text-[10px]">RUT</Label>
                        <Input
                          value={aiCleanedData.rut || ''}
                          onChange={(e) => setAiCleanedData({ ...aiCleanedData, rut: e.target.value })}
                          className="h-8 text-xs font-mono"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-3">
                      <p className="text-xs font-bold text-primary uppercase">Datos de Contacto</p>
                      <div className="flex flex-col gap-1">
                        <Label className="text-[10px]">Correo Electrónico</Label>
                        <Input
                          value={aiCleanedData.email || ''}
                          onChange={(e) => setAiCleanedData({ ...aiCleanedData, email: e.target.value })}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label className="text-[10px]">Teléfono</Label>
                        <Input
                          value={aiCleanedData.phone || ''}
                          onChange={(e) => setAiCleanedData({ ...aiCleanedData, phone: e.target.value })}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label className="text-[10px]">Dirección Física</Label>
                        <Input
                          value={aiCleanedData.address || ''}
                          onChange={(e) => setAiCleanedData({ ...aiCleanedData, address: e.target.value })}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Extracted Products list */}
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-bold text-primary uppercase">Catálogo Identificado ({aiCleanedData.products.length} productos)</p>
                    <div className="border border-border rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Nombre</TableHead>
                            <TableHead>Descripción</TableHead>
                            <TableHead className="text-right">Precio</TableHead>
                            <TableHead className="text-right">Unidad</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {aiCleanedData.products.map((p, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="font-semibold text-xs">{p.name}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{p.description || '—'}</TableCell>
                              <TableCell className="text-right font-mono font-bold text-xs">
                                {p.price ? `$${p.price.toLocaleString('es-CL')}` : '—'}
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">{p.unit || 'unidades'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-5 border-t border-border flex justify-end gap-2 bg-muted/10">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowAiCleaner(false);
                  setAiCleanedData(null);
                  setAiRawText('');
                }}
                disabled={savingAiData}
              >
                Cerrar
              </Button>
              {aiCleanedData && (
                <Button
                  type="button"
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                  onClick={handleSaveAiData}
                  disabled={savingAiData}
                >
                  {savingAiData ? (
                    <>
                      <Loader2 className="size-4 animate-spin mr-1" />
                      Importando Proveedor...
                    </>
                  ) : (
                    'Confirmar e Importar'
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
