"""Dependency-free data preparation and evaluation used inside the Colab notebook."""
import collections
import hashlib
import json
import math
import random
import re

FIELDS = ("task", "endpoints", "access", "rules", "response_shape")
LABELS = {"irrelevant": 0, "useful": 1, "essential": 2}


def query_text(row):
    return "\n".join(f"{key}: {row[key].strip()}" for key in FIELDS if row.get(key, "").strip())


def passage_text(row):
    return f"path: {row['path']}\nrole: {row.get('role', 'source')}\ncode:\n{row['content']}"


def make_demo_rows():
    """Original synthetic examples: smoke test only, not a production benchmark."""
    rows = []
    domains = ["Interview", "Invoice", "Booking", "Shipment", "Ticket", "Enrollment",
               "Appointment", "Expense", "Subscription", "Delivery", "Reservation", "Application"]
    for number, entity in enumerate(domains):
        plural = entity.lower() + "s"
        repo = f"demo-{number:02d}"
        stack = ["express-prisma", "django", "fastapi", "react"][number % 4]
        if stack == "express-prisma":
            units = [
                (f"src/controllers/{entity}Controller.ts", "controller", f"export async function create{entity}(req, res) {{ const result = await prisma.{entity.lower()}.create({{data: req.body}}); return sendSuccess(res, result, 201); }}"),
                (f"src/routes/{entity}Routes.ts", "route", f"router.post('/{plural}', requireRole('operator'), create{entity}); router.get('/{plural}', requireAuth, list{entity});"),
                ("prisma/schema.prisma", "model", f"model {entity} {{\n id Int @id @default(autoincrement())\n ownerId Int\n status {entity}Status\n @@map(\"{plural}\")\n}}\nenum {entity}Status {{\n PENDING\n ACTIVE\n}}"),
                ("src/middleware/auth.ts", "auth", f"// Access policy for {entity}\nexport const requireRole = (role) => (req,res,next) => req.user.role === role ? next() : sendError(res, 403, 'FORBIDDEN');"),
                ("src/utils/response.ts", "response", f"// Shared {entity} response contract\nexport const sendSuccess = (res, data, status=200) => res.status(status).json({{data}}); export const sendError = (res, status, code) => res.status(status).json({{error:{{code}}}});"),
                (f"src/services/list{entity}.ts", "service", f"export async function list{entity}(ownerId, page, limit) {{ const where={{ownerId}}; return {{data:await prisma.{entity.lower()}.findMany({{where,skip:(page-1)*limit,take:limit}}),paging:{{total:await prisma.{entity.lower()}.count({{where}}),page,limit}}}}; }}"),
                ("src/services/weather.ts", "unrelated", f"// {repo} independent weather integration\nexport function getForecast(city) {{ return weatherClient.lookup(city); }}"),
                ("docs/changelog.md", "documentation", f"{repo}: landing-page icon spacing and release-note formatting."),
            ]
        elif stack == "django":
            units = [
                (f"{plural}/views.py", "controller", f"class {entity}CreateView(CreateAPIView):\n    serializer_class = {entity}Serializer\n    permission_classes = [IsOperator]\n    def perform_create(self, serializer):\n        serializer.save(owner=self.request.user)"),
                (f"{plural}/urls.py", "route", f"urlpatterns = [path('{plural}/', {entity}CreateView.as_view()), path('{plural}/list/', {entity}ListView.as_view())]"),
                (f"{plural}/models.py", "model", f"class {entity}(models.Model):\n    class Status(models.TextChoices):\n        PENDING = 'pending'\n        ACTIVE = 'active'\n    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='{plural}')\n    status = models.CharField(max_length=16, choices=Status.choices)"),
                (f"{plural}/permissions.py", "auth", f"class IsOperator(BasePermission):\n    # {entity} access contract\n    def has_permission(self, request, view):\n        return request.user.is_authenticated and request.user.role == 'operator'"),
                (f"{plural}/serializers.py", "response", f"class {entity}Serializer(serializers.ModelSerializer):\n    class Meta:\n        model = {entity}\n        fields = ['id', 'status']"),
                (f"{plural}/pagination.py", "service", f"class {entity}Pagination(PageNumberPagination):\n    page_size = 20\n    page_size_query_param = 'limit'\n    max_page_size = 100"),
                ("weather/client.py", "unrelated", f"# {repo} weather service\ndef forecast(city):\n    return provider.lookup(city)"),
                ("docs/changelog.md", "documentation", f"{repo}: documentation navigation and release formatting."),
            ]
        elif stack == "fastapi":
            units = [
                (f"app/routers/{plural}.py", "controller", f"@router.post('/{plural}', response_model={entity}Out)\ndef create_{entity.lower()}(data: {entity}In, user=Depends(require_operator), db=Depends(get_db)):\n    return create_record(db, data, owner_id=user.id)"),
                ("app/main.py", "route", f"app = FastAPI()\napp.include_router({plural}.router, prefix='/api')"),
                (f"app/models/{plural}.py", "model", f"class {entity}(Base):\n    __tablename__ = '{plural}'\n    id = mapped_column(Integer, primary_key=True)\n    owner_id = mapped_column(ForeignKey('users.id'))\n    status = mapped_column(Enum('pending', 'active', name='{entity.lower()}_status'))"),
                (f"app/dependencies/{plural}_auth.py", "auth", f"def require_operator(user=Depends(current_user)):\n    # {entity} role policy\n    if user.role != 'operator':\n        raise HTTPException(status_code=403, detail='Forbidden')\n    return user"),
                (f"app/schemas/{plural}.py", "response", f"class {entity}In(BaseModel):\n    status: Literal['pending', 'active']\nclass {entity}Out({entity}In):\n    id: int\n    model_config = ConfigDict(from_attributes=True)"),
                (f"app/services/{plural}_list.py", "service", f"def list_{plural}(db, owner_id, page=1, limit=20):\n    stmt = select({entity}).where({entity}.owner_id == owner_id).offset((page-1)*limit).limit(limit)\n    return db.scalars(stmt).all()"),
                ("app/weather.py", "unrelated", f"# {repo} forecast client\ndef forecast(city):\n    return weather.lookup(city)"),
                ("docs/changelog.md", "documentation", f"{repo}: build badge and logo documentation."),
            ]
        else:
            units = [
                (f"src/components/{entity}Form.tsx", "controller", f"export function {entity}Form() {{ const create=useCreate{entity}(); return <form onSubmit={{create.submit}}><StatusSelect values={{['pending','active']}} /><button>Save</button></form>; }}"),
                ("src/routes.tsx", "route", f"<Route path='/manage/{plural}/new' element={{<RequireRole role='operator'><{entity}Form /></RequireRole>}} />"),
                (f"src/types/{entity}.ts", "model", f"export type {entity} = {{id: number; ownerId: number; status: 'pending' | 'active'}};"),
                (f"src/auth/{entity}Access.tsx", "auth", f"// {entity} UI access; the API must enforce authorization too\nexport function RequireRole({{role,children}}) {{ const user=useSession(); return user?.role === role ? children : <Forbidden />; }}"),
                (f"src/api/{entity}Api.ts", "response", f"export async function create{entity}(data: Omit<{entity},'id'>) {{ const response=await client.post('/{plural}',data); return response.data.data; }}"),
                (f"src/hooks/use{entity}List.ts", "service", f"export function use{entity}List(page:number,limit:number) {{ return useQuery({{queryKey:['{plural}',page,limit],queryFn:()=>client.get('/{plural}',{{params:{{page,limit}}}})}}); }}"),
                ("src/weather.tsx", "unrelated", f"export function Weather{number}() {{ return <span>Sunny</span>; }}"),
                ("docs/changelog.md", "documentation", f"{repo}: marketing colors and typography release notes."),
            ]
        for task_index in (0, 1):
            task = f"Create a protected {entity.lower()} flow" if task_index == 0 else f"Add owner-scoped pagination for {plural}"
            labels = [2, 2, 2, 2, 2, 1, 0, 0] if task_index == 0 else [1, 1, 2, 2, 1, 2, 0, 0]
            for index, (path, role, content) in enumerate(units):
                rows.append({"repo_id": repo, "task_id": f"{repo}-task-{task_index}", "task": task,
                    "endpoints": f"POST /{plural}" if task_index == 0 else f"GET /{plural}?page=1&limit=20",
                    "access": "Authenticated operator" if task_index == 0 else "Authenticated owner; only their records",
                    "rules": "Validate status against the existing type; use the current access checks" if task_index == 0 else "Preserve owner filtering; paginate without exposing another user's records",
                    "response_shape": "Use the existing project response conventions", "candidate_id": f"unit-{index}",
                    "path": path, "role": role, "content": content, "label": labels[index]})
    return rows


def validate_rows(rows):
    if not isinstance(rows, list) or not rows:
        raise ValueError("The dataset must contain JSONL candidate records.")
    if len(rows) > 100_000:
        raise ValueError("Start with at most 100,000 labeled candidates in one Colab run.")
    clean, seen, queries, grouped = [], set(), {}, collections.defaultdict(list)
    leaks = re.compile(r"(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]+|-----BEGIN [^-]*PRIVATE KEY-----|\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}|(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?)://[^\s/@]+:[^\s/@]+@|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b)")
    for index, item in enumerate(rows, 1):
        row = dict(item)
        for key in ("repo_id", "task_id", "task", "candidate_id", "path", "content"):
            if not isinstance(row.get(key), str) or not row[key].strip():
                raise ValueError(f"Row {index}: {key} must be a nonempty string.")
        for key in FIELDS[1:] + ("role",):
            if key in row and not isinstance(row[key], str):
                raise ValueError(f"Row {index}: {key} must be a string.")
        if len(row["content"]) > 32_000 or len(query_text(row)) > 8000:
            raise ValueError(f"Row {index}: split large files into complete functions, types, or model blocks.")
        label = row.get("label")
        if isinstance(label, str):
            label = LABELS.get(label.lower())
        if type(label) is not int or label not in (0, 1, 2):
            raise ValueError(f"Row {index}: label must be 0/1/2 or irrelevant/useful/essential.")
        row["label"] = label
        text = json.dumps(row, ensure_ascii=False)
        if leaks.search(text) or re.search(r'"(?:sample_rows|sample_documents)"\s*:', row["content"]):
            raise ValueError(f"Row {index}: possible private data or credentials. Sanitize locally before uploading; this scan is not comprehensive.")
        key = (row["repo_id"], row["task_id"])
        unique = (*key, row["candidate_id"])
        if unique in seen:
            raise ValueError(f"Row {index}: duplicate candidate identifier within a task.")
        seen.add(unique)
        if key in queries and queries[key] != query_text(row):
            raise ValueError(f"Row {index}: all candidates of a task must have identical requirements.")
        queries[key] = query_text(row)
        grouped[key].append(row)
        clean.append(row)
    if len({row["repo_id"] for row in clean}) < 3:
        raise ValueError("At least three independent repositories are required for train/validation/test separation.")
    for key, group in grouped.items():
        if len(group) < 4 or 2 not in {r["label"] for r in group} or 0 not in {r["label"] for r in group}:
            raise ValueError(f"Task {key}: label at least four candidates, including essential and irrelevant examples.")
    return clean


def dataset_hash(rows):
    normalized = sorted(rows, key=lambda r: (r["repo_id"], r["task_id"], r["candidate_id"]))
    return hashlib.sha256(json.dumps(normalized, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def split_repositories(rows, seed=42):
    repositories = sorted({r["repo_id"] for r in rows})
    random.Random(seed).shuffle(repositories)
    heldout = max(1, math.ceil(len(repositories) * .20))
    groups = {"train": set(repositories[:-2 * heldout]), "validation": set(repositories[-2 * heldout:-heldout]), "test": set(repositories[-heldout:])}
    return {name: [r for r in rows if r["repo_id"] in ids] for name, ids in groups.items()}


def training_pairs(rows, seed=42, maximum_per_task=32):
    grouped = collections.defaultdict(list)
    for row in rows:
        grouped[(row["repo_id"], row["task_id"])].append(row)
    rng, pairs = random.Random(seed), []
    for group in grouped.values():
        local = [(query_text(a), passage_text(a), passage_text(b), float(a["label"] - b["label"]))
                 for a in group for b in group if a["label"] > b["label"]]
        rng.shuffle(local)
        pairs.extend(local[:maximum_per_task])
    return pairs


def unit_cost(row):
    return math.ceil(len(json.dumps({"path": row["path"], "content": row["content"]}, ensure_ascii=False).encode()) / 3)


def select_under_budget(rows, scores, budget=2000):
    chosen, used = [], 0
    for index in sorted(range(len(rows)), key=lambda i: (-float(scores[i]), rows[i]["candidate_id"])):
        cost = unit_cost(rows[index])
        if used + cost <= budget:
            chosen.append(index)
            used += cost
    return chosen, used


def ranking_metrics(rows, scores, budget=2000, k=5):
    order = sorted(range(len(rows)), key=lambda i: (-float(scores[i]), rows[i]["candidate_id"]))
    gains = [2 ** rows[i]["label"] - 1 for i in order[:k]]
    ideal = sorted([2 ** r["label"] - 1 for r in rows], reverse=True)[:k]
    dcg = lambda items: sum(gain / math.log2(index + 2) for index, gain in enumerate(items))
    chosen, used = select_under_budget(rows, scores, budget)
    essential = sum(r["label"] == 2 for r in rows)
    return {"ndcg_at_5": dcg(gains) / dcg(ideal) if dcg(ideal) else 0.,
        "essential_recall_at_budget": sum(rows[i]["label"] == 2 for i in chosen) / essential if essential else 0.,
        "irrelevant_token_fraction": sum(unit_cost(rows[i]) for i in chosen if rows[i]["label"] == 0) / used if used else 0.,
        "estimated_selected_tokens": float(used),
        "mrr": next((1. / (rank + 1) for rank, i in enumerate(order) if rows[i]["label"] == 2), 0.)}


def keyword_scores(query, rows):
    """Independent keyword baseline, not the complete current Contexa selector."""
    words = lambda text: re.findall(r"[a-z][a-z0-9_]+", re.sub(r"([a-z])([A-Z])", r"\1 \2", text).lower())
    query_words = set(words(query))
    docs = [collections.Counter(words(passage_text(r))) for r in rows]
    average = sum(sum(d.values()) for d in docs) / max(1, len(docs))
    scores = []
    for doc in docs:
        score = 0.
        for word in query_words:
            frequency = sum(word in d for d in docs)
            tf = doc[word]
            score += math.log(1 + (len(docs) - frequency + .5) / (frequency + .5)) * tf * 2.2 / (tf + 1.2 * (.25 + .75 * sum(doc.values()) / max(1, average)))
        scores.append(score)
    return scores


def evaluate(rows, score_fn, budget=2000):
    groups = collections.defaultdict(list)
    for row in rows:
        groups[(row["repo_id"], row["task_id"])].append(row)
    metrics = [ranking_metrics(group, score_fn(query_text(group[0]), group), budget) for group in groups.values()]
    return {key: sum(m[key] for m in metrics) / len(metrics) for key in metrics[0]}
