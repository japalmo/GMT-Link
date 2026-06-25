export interface ProviderView {
  id: string;
  rut: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  score: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderProductView {
  id: string;
  providerId: string;
  name: string;
  description: string | null;
  price: number | null;
  unit: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderRatingView {
  id: string;
  providerId: string;
  score: number;
  comment: string | null;
  actorId: string;
  createdAt: string;
  actor?: { firstName: string; lastName: string } | null;
}
