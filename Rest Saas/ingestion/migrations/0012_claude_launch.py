import uuid
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('ingestion', '0011_context_library_index')]
    operations = [migrations.CreateModel(
        name='ClaudeLaunch',
        fields=[
            ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ('encrypted_prompt', models.TextField()),
            ('expires_at', models.DateTimeField(db_index=True)),
            ('context', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='claude_launches', to='ingestion.ingestioncontext')),
        ],
    )]
