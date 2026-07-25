import os
import requests
import json

# GitHub credentials
GITHUB_TOKEN = os.environ.get('GH_TOKEN', '')
OWNER = 'dev-guime'
REPO = 'VORTEX-LAUNCHER-2.0'
VERSION = '2.4.0'
TAG = f'v{VERSION}'

if not GITHUB_TOKEN:
    print('❌ GH_TOKEN não está configurado!')
    print('Configure com: $env:GH_TOKEN = "seu_token"')
    exit(1)

# Headers
headers = {
    'Authorization': f'token {GITHUB_TOKEN}',
    'Accept': 'application/vnd.github.v3+json'
}

# Create release
print(f'📦 Criando release {TAG}...')
release_data = {
    'tag_name': TAG,
    'name': f'Umbra Launcher v{VERSION}',
    'body': 'Auto-update system fixed for public repositories',
    'draft': False,
    'prerelease': False
}

response = requests.post(
    f'https://api.github.com/repos/{OWNER}/{REPO}/releases',
    headers=headers,
    data=json.dumps(release_data)
)

if response.status_code == 201:
    print('✅ Release criada com sucesso!')
    release_id = response.json()['id']
    upload_url = response.json()['upload_url'].split('{')[0]
elif response.status_code == 422:
    print('⚠️ Release já existe, buscando...')
    response = requests.get(
        f'https://api.github.com/repos/{OWNER}/{REPO}/releases/tags/{TAG}',
        headers=headers
    )
    if response.status_code == 200:
        release_id = response.json()['id']
        upload_url = response.json()['upload_url'].split('{')[0]
        print(f'✅ Release encontrada: {release_id}')
    else:
        print(f'❌ Erro ao buscar release: {response.status_code}')
        print(response.text)
        exit(1)
else:
    print(f'❌ Erro ao criar release: {response.status_code}')
    print(response.text)
    exit(1)

# Upload files
files = [
    f'release/Umbra Launcher Setup {VERSION}.exe',
    f'release/Umbra Launcher Setup {VERSION}.exe.blockmap'
]

for file_path in files:
    if not os.path.exists(file_path):
        print(f'⚠️ Arquivo não encontrado: {file_path}')
        continue

    file_name = os.path.basename(file_path)
    print(f'📤 Uploading {file_name}...')

    with open(file_path, 'rb') as f:
        upload_headers = headers.copy()
        upload_headers['Content-Type'] = 'application/octet-stream'

        response = requests.post(
            f'{upload_url}?name={file_name}',
            headers=upload_headers,
            data=f.read()
        )

        if response.status_code == 201:
            print(f'✅ {file_name} uploaded!')
        else:
            print(f'❌ Erro ao fazer upload de {file_name}: {response.status_code}')
            print(response.text)

# Create latest.yml
print('📝 Criando latest.yml...')
latest_yml = f'''version: {VERSION}
files:
  - url: Umbra Launcher Setup {VERSION}.exe
    sha512: PLACEHOLDER
    size: 0
path: Umbra Launcher Setup {VERSION}.exe
sha512: PLACEHOLDER
releaseDate: 2025-12-21T00:00:00.000Z
'''

with open('release/latest.yml', 'w') as f:
    f.write(latest_yml)

print('📤 Uploading latest.yml...')
with open('release/latest.yml', 'rb') as f:
    upload_headers = headers.copy()
    upload_headers['Content-Type'] = 'application/octet-stream'

    response = requests.post(
        f'{upload_url}?name=latest.yml',
        headers=upload_headers,
        data=f.read()
    )

    if response.status_code == 201:
        print('✅ latest.yml uploaded!')
    else:
        print(f'❌ Erro ao fazer upload de latest.yml: {response.status_code}')

print(f'\n✅ CONCLUÍDO! Release disponível em:')
print(f'https://github.com/{OWNER}/{REPO}/releases/tag/{TAG}')
