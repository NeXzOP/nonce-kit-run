// probSAT (break-only, exponential) for k-SAT. usage: probsat file.cnf cb seed  -> prints assignment line on success
#include <stdio.h>
#include <stdlib.h>
#include <math.h>
int N,M,K=0,*cl,*csz,*cst,**occ,*noc,*a,*ns,*uns,*pos,nu=0;
static inline int L(int l){return l>0?2*l:-2*l+1;}
static unsigned long long rs;static inline unsigned rnd(){rs^=rs<<13;rs^=rs>>7;rs^=rs<<17;return (unsigned)(rs>>11);}
int main(int ac,char**av){if(ac<4){fprintf(stderr,"usage\n");return 2;}
double CB=atof(av[2]);rs=88172645463325252ULL^(unsigned long long)atoll(av[3])*2654435761ULL;
FILE*f=fopen(av[1],"r");if(fscanf(f," p cnf %d %d",&N,&M)!=2)return 2;
int cap=M*6,n=0;cl=malloc(sizeof(int)*cap);cst=malloc(sizeof(int)*(M+1));csz=malloc(sizeof(int)*M);
noc=calloc(2*N+2,sizeof(int));
for(int i=0;i<M;i++){cst[i]=n;int x;while(fscanf(f,"%d",&x)==1&&x!=0){if(n>=cap){cap*=2;cl=realloc(cl,sizeof(int)*cap);}cl[n++]=x;noc[L(x)]++;}csz[i]=n-cst[i];}
cst[M]=n;occ=malloc(sizeof(int*)*(2*N+2));
for(int i=0;i<2*N+2;i++){occ[i]=malloc(sizeof(int)*(noc[i]+1));noc[i]=0;}
for(int i=0;i<M;i++)for(int j=cst[i];j<cst[i+1];j++){int k=L(cl[j]);occ[k][noc[k]++]=i;}
double pr[256];for(int i=0;i<256;i++)pr[i]=pow(CB,-i);
a=malloc(sizeof(int)*(N+1));ns=malloc(sizeof(int)*M);uns=malloc(sizeof(int)*M);pos=malloc(sizeof(int)*M);
for(int v=1;v<=N;v++)a[v]=rnd()&1;
for(int i=0;i<M;i++){ns[i]=0;for(int j=cst[i];j<cst[i+1];j++){int l=cl[j];ns[i]+=((l>0)==a[abs(l)]);}if(!ns[i]){pos[i]=nu;uns[nu++]=i;}}
double p[64];
while(nu){int c=uns[rnd()%nu];double s=0;int sz=csz[c];
 for(int j=0;j<sz;j++){int v=abs(cl[cst[c]+j]);int tl=a[v]?L(v):L(-v);int br=0;for(int k=0;k<noc[tl];k++)if(ns[occ[tl][k]]==1)br++;p[j]=pr[br>255?255:br];s+=p[j];}
 double r=(double)rnd()/4294967296.0*2048.0;r=fmod(r,1.0)*s;int j=0;for(;j<sz-1;j++){r-=p[j];if(r<=0)break;}
 int v=abs(cl[cst[c]+j]);int tl=a[v]?L(v):L(-v);a[v]^=1;int fl=a[v]?L(v):L(-v);
 for(int k=0;k<noc[tl];k++){int q=occ[tl][k];if(--ns[q]==0){pos[q]=nu;uns[nu++]=q;}}
 for(int k=0;k<noc[fl];k++){int q=occ[fl][k];if(ns[q]++==0){int x=uns[--nu];uns[pos[q]]=x;pos[x]=pos[q];}}
}
for(int v=1;v<=N;v++)putchar('0'+a[v]);putchar('\n');fflush(stdout);return 0;}
