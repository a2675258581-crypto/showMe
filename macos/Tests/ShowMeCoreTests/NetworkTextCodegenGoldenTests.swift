import XCTest
@testable import ShowMeCore

// 网页版 http-codegen.ts 对同一条命令生成的代码（逐字节对照）

final class NetworkTextCodegenGoldenTests: XCTestCase {
    static let cases: [(String, [String: String])] = [
        (
            #"""
curl -X POST https://upload.example.com/api/files -u 'admin:s3cr3t' -F 'title=年度报告' -F 'file=@./report-2026.pdf;type=application/pdf' -F 'cover=@/Users/me/Pictures/cover.png' -L --max-time 30
"""#,
            [
                "curl": #"""
curl 'https://upload.example.com/api/files' \
  -u 'admin:s3cr3t' \
  -F 'title=年度报告' \
  -F 'file=@./report-2026.pdf;type=application/pdf' \
  -F 'cover=@/Users/me/Pictures/cover.png' \
  -L \
  -m 30
"""#,
                "fetch": #"""
const form = new FormData()
form.append('title', '年度报告')
form.append('file', new File([/* report-2026.pdf 的内容 */], 'report-2026.pdf', { type: 'application/pdf' }))
form.append('cover', new File([/* cover.png 的内容 */], 'cover.png'))

const response = await fetch('https://upload.example.com/api/files', {
  method: 'POST',
  headers: {
    'Authorization': 'Basic ' + btoa('admin:s3cr3t'),
  },
  body: form,
  signal: AbortSignal.timeout(30000),
})

console.log(response.status)
console.log(await response.text())
"""#,
                "axios": #"""
import axios from 'axios'
import { openAsBlob } from 'node:fs'

const form = new FormData()
form.append('title', '年度报告')
form.append('file', await openAsBlob('./report-2026.pdf', { type: 'application/pdf' }), 'report-2026.pdf')
form.append('cover', await openAsBlob('/Users/me/Pictures/cover.png'), 'cover.png')

const response = await axios.request({
  method: 'post',
  url: 'https://upload.example.com/api/files',
  data: form,
  auth: { username: 'admin', password: 's3cr3t' },
  timeout: 30000,
})

console.log(response.status)
console.log(response.data)
"""#,
                "python": #"""
import requests

files = {
    'title': (None, '年度报告'),
    'file': ('report-2026.pdf', open('./report-2026.pdf', 'rb'), 'application/pdf'),
    'cover': ('cover.png', open('/Users/me/Pictures/cover.png', 'rb')),
}

response = requests.post(
    'https://upload.example.com/api/files',
    files=files,
    auth=('admin', 's3cr3t'),
    timeout=30,
)

print(response.status_code)
print(response.text)
"""#,
                "node": #"""
import { openAsBlob } from 'node:fs'

const form = new FormData()
form.append('title', '年度报告')
form.append('file', await openAsBlob('./report-2026.pdf', { type: 'application/pdf' }), 'report-2026.pdf')
form.append('cover', await openAsBlob('/Users/me/Pictures/cover.png'), 'cover.png')

const response = await fetch('https://upload.example.com/api/files', {
  method: 'POST',
  headers: {
    'Authorization': 'Basic ' + btoa('admin:s3cr3t'),
  },
  body: form,
  signal: AbortSignal.timeout(30000),
})

console.log(response.status)
console.log(await response.text())
"""#,
                "httpx": #"""
import httpx

files = {
    'title': (None, '年度报告'),
    'file': ('report-2026.pdf', open('./report-2026.pdf', 'rb'), 'application/pdf'),
    'cover': ('cover.png', open('/Users/me/Pictures/cover.png', 'rb')),
}

response = httpx.post(
    'https://upload.example.com/api/files',
    files=files,
    auth=('admin', 's3cr3t'),
    timeout=30,
    follow_redirects=True,
)

print(response.status_code)
print(response.text)
"""#,
                "go": #"""
package main

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"time"
)

func main() {
	client := &http.Client{
		Timeout: 30 * time.Second,
	}
	data := &bytes.Buffer{}
	writer := multipart.NewWriter(data)
	if err := writer.WriteField("title", "年度报告"); err != nil {
		log.Fatal(err)
	}
	file1, err := os.Open("./report-2026.pdf")
	if err != nil {
		log.Fatal(err)
	}
	defer file1.Close()
	part1, err := writer.CreateFormFile("file", "report-2026.pdf")
	if err != nil {
		log.Fatal(err)
	}
	if _, err := io.Copy(part1, file1); err != nil {
		log.Fatal(err)
	}
	file2, err := os.Open("/Users/me/Pictures/cover.png")
	if err != nil {
		log.Fatal(err)
	}
	defer file2.Close()
	part2, err := writer.CreateFormFile("cover", "cover.png")
	if err != nil {
		log.Fatal(err)
	}
	if _, err := io.Copy(part2, file2); err != nil {
		log.Fatal(err)
	}
	writer.Close()
	req, err := http.NewRequest("POST", "https://upload.example.com/api/files", data)
	if err != nil {
		log.Fatal(err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.SetBasicAuth("admin", "s3cr3t")
	resp, err := client.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	bodyText, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(resp.Status)
	fmt.Printf("%s\n", bodyText)
}
"""#,
                "java-okhttp": #"""
import java.io.File;
import java.io.IOException;
import java.util.concurrent.TimeUnit;
import okhttp3.Credentials;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class Main {
    public static void main(String[] args) throws IOException {
        OkHttpClient client = new OkHttpClient.Builder()
            .callTimeout(30000, TimeUnit.MILLISECONDS)
            .build();

        RequestBody body = new MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("title", "年度报告")
            .addFormDataPart("file", "report-2026.pdf",
                RequestBody.create(new File("./report-2026.pdf"), MediaType.parse("application/pdf")))
            .addFormDataPart("cover", "cover.png",
                RequestBody.create(new File("/Users/me/Pictures/cover.png"), null))
            .build();

        Request request = new Request.Builder()
            .url("https://upload.example.com/api/files")
            .method("POST", body)
            .addHeader("Authorization", Credentials.basic("admin", "s3cr3t"))
            .build();

        try (Response response = client.newCall(request).execute()) {
            System.out.println(response.code());
            System.out.println(response.body().string());
        }
    }
}
"""#,
                "java": #"""
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Base64;

public class Main {
    public static void main(String[] args) throws Exception {
        HttpClient client = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

        String boundary = "----JavaFormBoundary" + System.nanoTime();
        ByteArrayOutputStream form = new ByteArrayOutputStream();
        form.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"title\"\r\n\r\n年度报告\r\n").getBytes(StandardCharsets.UTF_8));
        form.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"report-2026.pdf\"\r\nContent-Type: application/pdf\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        form.write(Files.readAllBytes(Path.of("./report-2026.pdf")));
        form.write("\r\n".getBytes(StandardCharsets.UTF_8));
        form.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"cover\"; filename=\"cover.png\"\r\nContent-Type: application/octet-stream\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        form.write(Files.readAllBytes(Path.of("/Users/me/Pictures/cover.png")));
        form.write("\r\n".getBytes(StandardCharsets.UTF_8));
        form.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("https://upload.example.com/api/files"))
            .timeout(Duration.ofMillis(30000))
            .header("Content-Type", "multipart/form-data; boundary=" + boundary)
            .header("Authorization", "Basic " + Base64.getEncoder().encodeToString("admin:s3cr3t".getBytes(StandardCharsets.UTF_8)))
            .method("POST", HttpRequest.BodyPublishers.ofByteArray(form.toByteArray()))
            .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.statusCode());
        System.out.println(response.body());
    }
}
"""#,
                "php": #"""
<?php

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://upload.example.com/api/files');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_USERPWD, 'admin:s3cr3t');
curl_setopt($ch, CURLOPT_POSTFIELDS, [
    'title' => '年度报告',
    'file' => new CURLFile('./report-2026.pdf', 'application/pdf', 'report-2026.pdf'),
    'cover' => new CURLFile('/Users/me/Pictures/cover.png', '', 'cover.png'),
]);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT_MS, 30000);

$response = curl_exec($ch);
if ($response === false) {
    echo 'Error: ' . curl_error($ch);
} else {
    echo curl_getinfo($ch, CURLINFO_RESPONSE_CODE) . PHP_EOL;
    echo $response;
}
curl_close($ch);
"""#,
                "rust": #"""
// Cargo.toml: reqwest = { version = "0.12", features = ["blocking", "multipart"] }
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let form = reqwest::blocking::multipart::Form::new()
        .text("title", "年度报告")
        .part("file", reqwest::blocking::multipart::Part::file("./report-2026.pdf")?.mime_str("application/pdf")?)
        .file("cover", "/Users/me/Pictures/cover.png")?;

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(30000))
        .build()?;
    let res = client
        .post("https://upload.example.com/api/files")
        .basic_auth("admin", Some("s3cr3t"))
        .multipart(form)
        .send()?;

    println!("{}", res.status());
    println!("{}", res.text()?);
    Ok(())
}
"""#,
                "swift": #"""
import Foundation

let url = URL(string: "https://upload.example.com/api/files")!
var request = URLRequest(url: url)
request.httpMethod = "POST"
request.timeoutInterval = 30
let credentials = Data("admin:s3cr3t".utf8).base64EncodedString()
request.setValue("Basic \(credentials)", forHTTPHeaderField: "Authorization")

let boundary = "Boundary-\(UUID().uuidString)"
var body = Data()
body.append(Data(("--\(boundary)" + "\r\nContent-Disposition: form-data; name=\"title\"\r\n\r\n年度报告\r\n").utf8))
body.append(Data(("--\(boundary)" + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"report-2026.pdf\"\r\nContent-Type: application/pdf\r\n\r\n").utf8))
body.append(try Data(contentsOf: URL(fileURLWithPath: "./report-2026.pdf")))
body.append(Data("\r\n".utf8))
body.append(Data(("--\(boundary)" + "\r\nContent-Disposition: form-data; name=\"cover\"; filename=\"cover.png\"\r\nContent-Type: application/octet-stream\r\n\r\n").utf8))
body.append(try Data(contentsOf: URL(fileURLWithPath: "/Users/me/Pictures/cover.png")))
body.append(Data("\r\n".utf8))
body.append(Data("--\(boundary)--\r\n".utf8))
request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
request.httpBody = body

let (data, response) = try await URLSession.shared.data(for: request)
if let http = response as? HTTPURLResponse {
    print(http.statusCode)
}
print(String(decoding: data, as: UTF8.self))
"""#,
                "csharp": #"""
using System.Net.Http.Headers;
using System.Text;

using var client = new HttpClient();
client.Timeout = TimeSpan.FromMilliseconds(30000);

using var request = new HttpRequestMessage(new HttpMethod("POST"), "https://upload.example.com/api/files");
request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes("admin:s3cr3t")));
var form = new MultipartFormDataContent();
form.Add(new StringContent("年度报告"), "title");
var file1 = new ByteArrayContent(File.ReadAllBytes("./report-2026.pdf"));
file1.Headers.ContentType = MediaTypeHeaderValue.Parse("application/pdf");
form.Add(file1, "file", "report-2026.pdf");
var file2 = new ByteArrayContent(File.ReadAllBytes("/Users/me/Pictures/cover.png"));
form.Add(file2, "cover", "cover.png");
request.Content = form;

using var response = await client.SendAsync(request);
Console.WriteLine((int)response.StatusCode);
Console.WriteLine(await response.Content.ReadAsStringAsync());
"""#,
                "wget": #"""
# 注意：wget 不支持 multipart/form-data 表单，已省略请求体，建议改用 curl 或 HTTPie
wget --quiet \
  --method=POST \
  --user='admin' \
  --password='s3cr3t' \
  --auth-no-challenge \
  --timeout=30 \
  --output-document=- \
  'https://upload.example.com/api/files'
"""#,
                "httpie": #"""
http --follow --timeout=30 --auth='admin:s3cr3t' --multipart POST 'https://upload.example.com/api/files' \
  'title=年度报告' \
  'file@./report-2026.pdf;type=application/pdf' \
  'cover@/Users/me/Pictures/cover.png'
"""#,
            ]
        ),
        (
            #"""
curl 'https://例子.测试/路径 1?q=中文#片段' -H 'Cookie: a=1' -H 'cookie: b=2' --json '{"n":12345678901234567890}' -k -m 2.5
"""#,
            [
                "curl": #"""
curl 'https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84%201?q=%E4%B8%AD%E6%96%87#%E7%89%87%E6%AE%B5' \
  -H 'Cookie: a=1' \
  -H 'cookie: b=2' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  --data-raw '{"n":12345678901234567890}' \
  -k \
  -m 2.5
"""#,
                "fetch": #"""
// 注意：浏览器会忽略这些受限的请求头：Cookie（Node.js 中有效）
// 注意：浏览器中无法跳过 TLS 证书校验（-k）
const response = await fetch('https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84%201?q=%E4%B8%AD%E6%96%87#%E7%89%87%E6%AE%B5', {
  method: 'POST',
  headers: {
    'Cookie': 'a=1; b=2',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  body: '{"n":12345678901234567890}',
  signal: AbortSignal.timeout(2500),
})

console.log(response.status)
console.log(await response.text())
"""#,
                "axios": #"""
import axios from 'axios'
import https from 'node:https'

const response = await axios.request({
  method: 'post',
  url: 'https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84%201?q=%E4%B8%AD%E6%96%87#%E7%89%87%E6%AE%B5',
  headers: {
    'Cookie': 'a=1; b=2',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  data: '{"n":12345678901234567890}',
  timeout: 2500,
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
})

console.log(response.status)
console.log(response.data)
"""#,
                "python": #"""
import requests

headers = {
    'Cookie': 'a=1; b=2',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
}

data = '{"n":12345678901234567890}'

response = requests.post(
    'https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84%201?q=%E4%B8%AD%E6%96%87#%E7%89%87%E6%AE%B5',
    headers=headers,
    data=data,
    timeout=2.5,
    verify=False,
)

print(response.status_code)
print(response.text)
"""#,
                "node": #"""
// 跳过 TLS 证书校验（-k）：运行前设置环境变量 NODE_TLS_REJECT_UNAUTHORIZED=0
const response = await fetch('https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84%201?q=%E4%B8%AD%E6%96%87#%E7%89%87%E6%AE%B5', {
  method: 'POST',
  headers: {
    'Cookie': 'a=1; b=2',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  body: '{"n":12345678901234567890}',
  signal: AbortSignal.timeout(2500),
})

console.log(response.status)
console.log(await response.text())
"""#,
                "httpx": #"""
import httpx

headers = {
    'Cookie': 'a=1; b=2',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
}

data = '{"n":12345678901234567890}'

response = httpx.post(
    'https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84%201?q=%E4%B8%AD%E6%96%87#%E7%89%87%E6%AE%B5',
    headers=headers,
    content=data,
    timeout=2.5,
    verify=False,
)

print(response.status_code)
print(response.text)
"""#,
                "go": #"""
package main

import (
	"crypto/tls"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

func main() {
	client := &http.Client{
		Timeout: 2500 * time.Millisecond,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}
	var data = strings.NewReader(`{"n":12345678901234567890}`)
	req, err := http.NewRequest("POST", "https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84%201?q=%E4%B8%AD%E6%96%87#%E7%89%87%E6%AE%B5", data)
	if err != nil {
		log.Fatal(err)
	}
	req.Header.Set("Cookie", "a=1")
	req.Header.Add("cookie", "b=2")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	bodyText, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(resp.Status)
	fmt.Printf("%s\n", bodyText)
}
"""#,
                "java-okhttp": #"""
import java.io.IOException;
import java.util.concurrent.TimeUnit;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class Main {
    public static void main(String[] args) throws IOException {
        // 注意：OkHttp 需要自定义 SSLSocketFactory 与 HostnameVerifier 才能跳过证书校验（-k）
        OkHttpClient client = new OkHttpClient.Builder()
            .callTimeout(2500, TimeUnit.MILLISECONDS)
            .build();

        RequestBody body = RequestBody.create("{\"n\":12345678901234567890}", MediaType.parse("application/json"));

        Request request = new Request.Builder()
            .url("https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84%201?q=%E4%B8%AD%E6%96%87#%E7%89%87%E6%AE%B5")
            .method("POST", body)
            .addHeader("Cookie", "a=1")
            .addHeader("cookie", "b=2")
            .addHeader("Accept", "application/json")
            .build();

        try (Response response = client.newCall(request).execute()) {
            System.out.println(response.code());
            System.out.println(response.body().string());
        }
    }
}
"""#,
                "java": #"""
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

public class Main {
    public static void main(String[] args) throws Exception {
        // 注意：跳过证书校验（-k）需要自定义 SSLContext，这里没有生成
        HttpClient client = HttpClient.newHttpClient();

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84%201?q=%E4%B8%AD%E6%96%87#%E7%89%87%E6%AE%B5"))
            .timeout(Duration.ofMillis(2500))
            .header("Cookie", "a=1")
            .header("cookie", "b=2")
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .method("POST", HttpRequest.BodyPublishers.ofString("{\"n\":12345678901234567890}"))
            .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.statusCode());
        System.out.println(response.body());
    }
}
"""#,
                "php": #"""
<?php

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84%201?q=%E4%B8%AD%E6%96%87#%E7%89%87%E6%AE%B5');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Cookie: a=1',
    'cookie: b=2',
    'Content-Type: application/json',
    'Accept: application/json',
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, '{"n":12345678901234567890}');
curl_setopt($ch, CURLOPT_TIMEOUT_MS, 2500);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);

$response = curl_exec($ch);
if ($response === false) {
    echo 'Error: ' . curl_error($ch);
} else {
    echo curl_getinfo($ch, CURLINFO_RESPONSE_CODE) . PHP_EOL;
    echo $response;
}
curl_close($ch);
"""#,
                "rust": #"""
// Cargo.toml: reqwest = { version = "0.12", features = ["blocking", "multipart"] }
use reqwest::header;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut headers = header::HeaderMap::new();
    headers.insert("cookie", "a=1".parse()?);
    headers.append("cookie", "b=2".parse()?);
    headers.insert("content-type", "application/json".parse()?);
    headers.insert("accept", "application/json".parse()?);

    let client = reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_millis(2500))
        .build()?;
    let res = client
        .post("https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84%201?q=%E4%B8%AD%E6%96%87#%E7%89%87%E6%AE%B5")
        .headers(headers)
        .body(r#"{"n":12345678901234567890}"#)
        .send()?;

    println!("{}", res.status());
    println!("{}", res.text()?);
    Ok(())
}
"""#,
                "swift": #"""
import Foundation

// 注意：跳过证书校验（-k）需要实现 URLSessionDelegate，这里没有生成
let url = URL(string: "https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84%201?q=%E4%B8%AD%E6%96%87#%E7%89%87%E6%AE%B5")!
var request = URLRequest(url: url)
request.httpMethod = "POST"
request.timeoutInterval = 2.5
request.setValue("a=1", forHTTPHeaderField: "Cookie")
request.addValue("b=2", forHTTPHeaderField: "cookie")
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.setValue("application/json", forHTTPHeaderField: "Accept")
request.httpBody = Data(#"{"n":12345678901234567890}"#.utf8)

let (data, response) = try await URLSession.shared.data(for: request)
if let http = response as? HTTPURLResponse {
    print(http.statusCode)
}
print(String(decoding: data, as: UTF8.self))
"""#,
                "csharp": #"""
using System.Net.Http.Headers;
using System.Text;

var handler = new HttpClientHandler
{
    ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
};
using var client = new HttpClient(handler);
client.Timeout = TimeSpan.FromMilliseconds(2500);

using var request = new HttpRequestMessage(new HttpMethod("POST"), "https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84%201?q=%E4%B8%AD%E6%96%87#%E7%89%87%E6%AE%B5");
request.Headers.TryAddWithoutValidation("Cookie", "a=1");
request.Headers.TryAddWithoutValidation("cookie", "b=2");
request.Headers.TryAddWithoutValidation("Accept", "application/json");
request.Content = new StringContent("{\"n\":12345678901234567890}");
request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse("application/json");

using var response = await client.SendAsync(request);
Console.WriteLine((int)response.StatusCode);
Console.WriteLine(await response.Content.ReadAsStringAsync());
"""#,
                "wget": #"""
wget --quiet \
  --method=POST \
  --header='Cookie: a=1' \
  --header='cookie: b=2' \
  --header='Content-Type: application/json' \
  --header='Accept: application/json' \
  --body-data='{"n":12345678901234567890}' \
  --timeout=2.5 \
  --no-check-certificate \
  --output-document=- \
  'https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84%201?q=%E4%B8%AD%E6%96%87#%E7%89%87%E6%AE%B5'
"""#,
                "httpie": #"""
http --verify=no --timeout=2.5 --raw='{"n":12345678901234567890}' POST 'https://xn--fsqu00a.xn--0zwm56d/%E8%B7%AF%E5%BE%84%201?q=%E4%B8%AD%E6%96%87#%E7%89%87%E6%AE%B5' \
  'Cookie:a=1' \
  'cookie:b=2' \
  'Content-Type:application/json' \
  'Accept:application/json'
"""#,
            ]
        ),
        (
            #"""
curl 'https://www.example.com/api/v2/search' \
  -H 'accept: application/json, text/plain, */*' \
  -H 'content-type: application/json;charset=UTF-8' \
  -b 'sid=abc; theme=dark' \
  -H 'sec-ch-ua: "Chromium";v="128", "Not;A=Brand";v="24"' \
  --data-raw '{"keyword":"耳机","page":1}'
"""#,
            [
                "curl": #"""
curl 'https://www.example.com/api/v2/search' \
  -H 'accept: application/json, text/plain, */*' \
  -H 'content-type: application/json;charset=UTF-8' \
  -H 'Cookie: sid=abc; theme=dark' \
  -H 'sec-ch-ua: "Chromium";v="128", "Not;A=Brand";v="24"' \
  --data-raw '{"keyword":"耳机","page":1}'
"""#,
                "fetch": #"""
// 注意：浏览器会忽略这些受限的请求头：Cookie, sec-ch-ua（Node.js 中有效）
const response = await fetch('https://www.example.com/api/v2/search', {
  method: 'POST',
  headers: {
    'accept': 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
    'Cookie': 'sid=abc; theme=dark',
    'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24"',
  },
  body: JSON.stringify({
    keyword: '耳机',
    page: 1,
  }),
})

console.log(response.status)
console.log(await response.text())
"""#,
                "axios": #"""
import axios from 'axios'

const response = await axios.request({
  method: 'post',
  url: 'https://www.example.com/api/v2/search',
  headers: {
    'accept': 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
    'Cookie': 'sid=abc; theme=dark',
    'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24"',
  },
  data: {
    keyword: '耳机',
    page: 1,
  },
})

console.log(response.status)
console.log(response.data)
"""#,
                "python": #"""
import requests

headers = {
    'accept': 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
    'Cookie': 'sid=abc; theme=dark',
    'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24"',
}

json_data = {
    'keyword': '耳机',
    'page': 1,
}

response = requests.post(
    'https://www.example.com/api/v2/search',
    headers=headers,
    json=json_data,
)

print(response.status_code)
print(response.text)
"""#,
                "node": #"""
const response = await fetch('https://www.example.com/api/v2/search', {
  method: 'POST',
  headers: {
    'accept': 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
    'Cookie': 'sid=abc; theme=dark',
    'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24"',
  },
  body: JSON.stringify({
    keyword: '耳机',
    page: 1,
  }),
})

console.log(response.status)
console.log(await response.text())
"""#,
                "httpx": #"""
import httpx

headers = {
    'accept': 'application/json, text/plain, */*',
    'content-type': 'application/json;charset=UTF-8',
    'Cookie': 'sid=abc; theme=dark',
    'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24"',
}

json_data = {
    'keyword': '耳机',
    'page': 1,
}

response = httpx.post(
    'https://www.example.com/api/v2/search',
    headers=headers,
    json=json_data,
)

print(response.status_code)
print(response.text)
"""#,
                "go": #"""
package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
)

func main() {
	client := &http.Client{}
	var data = strings.NewReader(`{"keyword":"耳机","page":1}`)
	req, err := http.NewRequest("POST", "https://www.example.com/api/v2/search", data)
	if err != nil {
		log.Fatal(err)
	}
	req.Header.Set("accept", "application/json, text/plain, */*")
	req.Header.Set("content-type", "application/json;charset=UTF-8")
	req.Header.Set("Cookie", "sid=abc; theme=dark")
	req.Header.Set("sec-ch-ua", "\"Chromium\";v=\"128\", \"Not;A=Brand\";v=\"24\"")
	resp, err := client.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	bodyText, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(resp.Status)
	fmt.Printf("%s\n", bodyText)
}
"""#,
                "java-okhttp": #"""
import java.io.IOException;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class Main {
    public static void main(String[] args) throws IOException {
        OkHttpClient client = new OkHttpClient();

        RequestBody body = RequestBody.create("{\"keyword\":\"耳机\",\"page\":1}", MediaType.parse("application/json;charset=UTF-8"));

        Request request = new Request.Builder()
            .url("https://www.example.com/api/v2/search")
            .method("POST", body)
            .addHeader("accept", "application/json, text/plain, */*")
            .addHeader("Cookie", "sid=abc; theme=dark")
            .addHeader("sec-ch-ua", "\"Chromium\";v=\"128\", \"Not;A=Brand\";v=\"24\"")
            .build();

        try (Response response = client.newCall(request).execute()) {
            System.out.println(response.code());
            System.out.println(response.body().string());
        }
    }
}
"""#,
                "java": #"""
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class Main {
    public static void main(String[] args) throws Exception {
        HttpClient client = HttpClient.newHttpClient();

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("https://www.example.com/api/v2/search"))
            .header("accept", "application/json, text/plain, */*")
            .header("content-type", "application/json;charset=UTF-8")
            .header("Cookie", "sid=abc; theme=dark")
            .header("sec-ch-ua", "\"Chromium\";v=\"128\", \"Not;A=Brand\";v=\"24\"")
            .method("POST", HttpRequest.BodyPublishers.ofString("{\"keyword\":\"耳机\",\"page\":1}"))
            .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        System.out.println(response.statusCode());
        System.out.println(response.body());
    }
}
"""#,
                "php": #"""
<?php

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://www.example.com/api/v2/search');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'accept: application/json, text/plain, */*',
    'content-type: application/json;charset=UTF-8',
    'Cookie: sid=abc; theme=dark',
    'sec-ch-ua: "Chromium";v="128", "Not;A=Brand";v="24"',
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, '{"keyword":"耳机","page":1}');

$response = curl_exec($ch);
if ($response === false) {
    echo 'Error: ' . curl_error($ch);
} else {
    echo curl_getinfo($ch, CURLINFO_RESPONSE_CODE) . PHP_EOL;
    echo $response;
}
curl_close($ch);
"""#,
                "rust": #"""
// Cargo.toml: reqwest = { version = "0.12", features = ["blocking", "multipart"] }
use reqwest::header;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut headers = header::HeaderMap::new();
    headers.insert("accept", "application/json, text/plain, */*".parse()?);
    headers.insert("content-type", "application/json;charset=UTF-8".parse()?);
    headers.insert("cookie", "sid=abc; theme=dark".parse()?);
    headers.insert("sec-ch-ua", "\"Chromium\";v=\"128\", \"Not;A=Brand\";v=\"24\"".parse()?);

    let client = reqwest::blocking::Client::new();
    let res = client
        .post("https://www.example.com/api/v2/search")
        .headers(headers)
        .body(r#"{"keyword":"耳机","page":1}"#)
        .send()?;

    println!("{}", res.status());
    println!("{}", res.text()?);
    Ok(())
}
"""#,
                "swift": #"""
import Foundation

let url = URL(string: "https://www.example.com/api/v2/search")!
var request = URLRequest(url: url)
request.httpMethod = "POST"
request.setValue("application/json, text/plain, */*", forHTTPHeaderField: "accept")
request.setValue("application/json;charset=UTF-8", forHTTPHeaderField: "content-type")
request.setValue("sid=abc; theme=dark", forHTTPHeaderField: "Cookie")
request.setValue("\"Chromium\";v=\"128\", \"Not;A=Brand\";v=\"24\"", forHTTPHeaderField: "sec-ch-ua")
request.httpBody = Data(#"{"keyword":"耳机","page":1}"#.utf8)

let (data, response) = try await URLSession.shared.data(for: request)
if let http = response as? HTTPURLResponse {
    print(http.statusCode)
}
print(String(decoding: data, as: UTF8.self))
"""#,
                "csharp": #"""
using System.Net.Http.Headers;
using System.Text;

using var client = new HttpClient();

using var request = new HttpRequestMessage(new HttpMethod("POST"), "https://www.example.com/api/v2/search");
request.Headers.TryAddWithoutValidation("accept", "application/json, text/plain, */*");
request.Headers.TryAddWithoutValidation("Cookie", "sid=abc; theme=dark");
request.Headers.TryAddWithoutValidation("sec-ch-ua", "\"Chromium\";v=\"128\", \"Not;A=Brand\";v=\"24\"");
request.Content = new StringContent("{\"keyword\":\"耳机\",\"page\":1}");
request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse("application/json;charset=UTF-8");

using var response = await client.SendAsync(request);
Console.WriteLine((int)response.StatusCode);
Console.WriteLine(await response.Content.ReadAsStringAsync());
"""#,
                "wget": #"""
wget --quiet \
  --method=POST \
  --header='accept: application/json, text/plain, */*' \
  --header='content-type: application/json;charset=UTF-8' \
  --header='Cookie: sid=abc; theme=dark' \
  --header='sec-ch-ua: "Chromium";v="128", "Not;A=Brand";v="24"' \
  --body-data='{"keyword":"耳机","page":1}' \
  --output-document=- \
  'https://www.example.com/api/v2/search'
"""#,
                "httpie": #"""
http --raw='{"keyword":"耳机","page":1}' POST 'https://www.example.com/api/v2/search' \
  'accept:application/json, text/plain, */*' \
  'content-type:application/json;charset=UTF-8' \
  'Cookie:sid=abc; theme=dark' \
  'sec-ch-ua:"Chromium";v="128", "Not;A=Brand";v="24"'
"""#,
            ]
        ),
    ]

    func testMatchesWebOutput() throws {
        for (command, expected) in Self.cases {
            let request = try Curl.parse(command).request
            for (target, code) in expected {
                let t = try XCTUnwrap(CodeTarget(rawValue: target))
                XCTAssertEqual(HTTPCodegen.generate(request, t, lang: .zh), code, "\(target): \(command)")
            }
        }
    }
}
