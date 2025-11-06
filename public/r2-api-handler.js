class R2ApiHandler {
    constructor(apiUrl = '/api/endpoint') {
        this.apiUrl = apiUrl;
        this.authToken = null;
    }

    setAuthToken(token) {
        this.authToken = token;
    }

    async _apiCall(action, body = {}) {
        if (!this.authToken) {
            throw new Error('認証トークンが設定されていません。');
        }

        const requestBody = { ...body, password: this.authToken, action: action };
        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            if (response.status === 401) throw new Error('パスワードが間違っています。');
            if (response.status === 403) throw new Error('この環境からのAPIアクセスはブロックされています。');
            throw new Error(`APIエラー (ステータス: ${response.status}): ${errorText}`);
        }
        return response.json();
    }

    async login() {
        return this._apiCall('list-files');
    }

    async listFiles() {
        return this._apiCall('list-files');
    }

    getDownloadLink(filename, productionUrl = 'https://download-link.pages.dev') {
        return `${productionUrl}/api/${encodeURIComponent(filename)}`;
    }

    async downloadFile(filename) {
        try {
            // ステップ1: バックエンドのエンドポイントにアクセスして、署名付きURLを取得する
            const backendApiUrl = this.getDownloadLink(filename);
            const signedUrlResponse = await fetch(backendApiUrl);

            if (!signedUrlResponse.ok) {
                throw new Error(`署名付きURLの取得に失敗しました。ステータス: ${signedUrlResponse.status}`);
            }

            // バックエンドから返されたJSONをパースしてURLを取り出す
            const data = await signedUrlResponse.json();
            const r2SignedUrl = data.url;

            // ステップ2: 取得した署名付きURLを使って、R2から直接ファイルをダウンロードする
            const fileResponse = await fetch(r2SignedUrl);

            if (!fileResponse.ok) {
                throw new Error(`ファイルのダウンロードに失敗しました。ステータス: ${fileResponse.status}`);
            }
            
            return fileResponse.blob();

        } catch (error) {
            console.error('ダウンロードエラー:', error);
            throw error;
        }
    }

    async uploadFile(file, onProgress) {
        if (!file) {
            throw new Error('ファイルが選択されていません。');
        }

        const { url } = await this._apiCall('generate-upload-url', { 
            filename: file.name, 
            contentType: file.type || 'application/octet-stream' 
        });

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', url, true);

            if (onProgress && typeof onProgress === 'function') {
                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        const percentComplete = (event.loaded / event.total) * 100;
                        onProgress(percentComplete);
                    }
                };
            }

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(xhr.response);
                } else {
                    reject(new Error(`アップロードに失敗しました。ステータス: ${xhr.status}, 応答: ${xhr.responseText}`));
                }
            };

            xhr.onerror = () => {
                reject(new Error('ネットワークエラーによりアップロードに失敗しました。'));
            };

            xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
            xhr.send(file);
        });
    }
}