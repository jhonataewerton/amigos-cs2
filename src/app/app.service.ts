import { HttpClient, HttpHeaders } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable } from "rxjs";

@Injectable({
  providedIn: "root",
})
export class AppService {
  baseUrl = "https://gamersclub.com.br/lobby/match/";

  constructor(private http: HttpClient) {}

  searchPartida(id: any): Observable<any> {
    const headers = new HttpHeaders({
      accept: "application/json, text/plain, */*",
      "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      referer: "https://gamersclub.com.br/lobby/match/23881069",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
      priority: "u=1, i",
      // Headers com `sec-ch-*` geralmente são ignorados por browsers, você pode omitir ou incluir:
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
    });

    // Cookies (alguns navegadores não deixam setar manualmente pelo front)
    const cookie =
      "language=pt-br; _gcl_au=1.1.6203506.1742255376; sib_cuid=2382fbd0-16e8-40f4-9483-7d8c69d262ca; _tt_enable_cookie=1; _ttp=01JPK86JWTXK0DZ02JYCM4E4XJ_.tt.2; _hjSessionUser_2263196=eyJpZCI6ImIzYTg3OWZjLWE2ZGEtNWU0Ny05ZDk0LTU3YmY0NGYwZDBjZCIsImNyZWF0ZWQiOjE3NDIyNTUzNzYzNzksImV4aXN0aW5nIjp0cnVlfQ==; _ga_H7ETJY03DT=deleted; _fbp=fb.2.1744325006954.155857944513336229; __gads=ID=e123a2c798732c10:T=1744325006:RT=1746838208:S=ALNI_Ma_iKN38ZRHL_7N2tDCV6TAycJ89g; __gpi=UID=00001096a92b055e:T=1744325006:RT=1746838208:S=ALNI_MZXPEAjy0rhbhndNL-zCzEDRXlPxA; __eoi=ID=da05b6d48035fc75:T=1744325006:RT=1746838208:S=AA-AfjZqJXjamuv9NSw7xcBlEGNL; _ga_GDBFGFR1PC=deleted; _gid=GA1.3.1681450047.1748882088; _ce.clock_data=832%2C45.160.238.32%2C1%2C0fe6feb54289f4c67027ec06cc2131f8%2CChrome%2CBR; _ga_JX5QEN370C=GS2.3.s1749167508$o2$g1$t1749167567$j1$l0$h0; x-gcid:accessToken=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwczpcL1wvZ2FtZXJzY2x1Yi5jb20uYnIiLCJleHAiOjE3NDkyMzkzODIsImdjSWQiOiI2NGRkMDU5OC0zNDY3LTQyOTEtYTc5Yy0zZTIxMjJiMzA5OWUifQ.vKO7cs67N-7ttXRv22i3xxVkWI8B84q6xiPsxKx_Y2M; _hjSession_2263196=eyJpZCI6ImI3OGVlNDJkLTIxNGYtNDE3ZS1iZTFmLWE4MzM3MjQ4N2I2YSIsImMiOjE3NDkyMjk5MDgwMTYsInMiOjAsInIiOjAsInNiIjowLCJzciI6MCwic2UiOjAsImZzIjowLCJzcCI6MX0=; cebs=1; cf_clearance=kjyusaCfY5FyifDrtqLLSwSB50EUeMmDIAX86wX1ihU-1749230885-1.2.1.1-MAmHL4gvdIQiYSfehIlMuOSrwUspX2fnYusQd9kfJmRI98YjIqqLvdFp68Vqg8gwnqHS55fLKsk_xnkdAVkCRijfUYeFU9w3uOsQwkivxW1R3hv4w_bz.tnWstcll8t8n_VuO9y_7hpbDFKVAYvSP5nhrD9xnjSYvD_ond9vnfYKRK1I32IR9FZrGr0OUezMNfPR3Bexj_tIIuHbl604wrbWt59VsBR_FwAwSUQG8V26TQ8ipFj.jlvKZzmuc7xB9G0y5gAA2rM0I5Fbk4XHMVfOuHPi8ckceMbDu81SSTkc1oOBoX4d198bns7g5BTjLPZ5t50Fti_RxIVcCL13i7TaHTLXgs_G2y54_V7Nk2slOIwZUsM.tqj6c5y_DbZs; gclubsess=ea2c0dac3b2a0d2e54cbd13dda5aecb1cf2a3852; 51QQyhcLyDRpqrY2Gh3vO=1; gcid:accessToken=zlwc39l_wNsgORf9F-h1MH2OUm6QyCuyHFmK2vPJtyc.czVktRl-CZhOkcCXxbwtgq5CVPp_p2IvFOcLsNnPS8w; _gat_UA-64910362-39=1; _gat_UA-64910362-1=1; i18next=lobby; cebsp_=12; _ce.s=v~f26fbeb228f659279b1db1b75802300a1abf8441~lcw~1749231087103~vir~returning~lva~1749231099638~vpv~46~as~false~v11.cs~419044~v11.s~47c14f30-37fd-11f0-b50f-4fd22b9a2df4~v11.vs~f26fbeb228f659279b1db1b75802300a1abf8441~v11ls~47c14f30-37fd-11f0-b50f-4fd22b9a2df4~v11.fsvd~e30%3D~lcw~1749231099638; _ga_1WKB6YC210=GS2.1.s1749229908$o221$g1$t1749231116$j29$l0$h0; ttcsid=1749229908132::ZJdEzerHEq_u1m6kTM4Y.178.1749231116576; _ga=GA1.1.878099943.1742255376; _ga_GDBFGFR1PC=GS2.1.s1749229908$o214$g1$t1749231116$j29$l0$h0; _ga_H7ETJY03DT=GS2.1.s1749229908$o214$g1$t1749231116$j29$l0$h0; _ga_HZPJ0EKL99=GS2.3.s1749229908$o223$g1$t1749231116$j30$l0$h0; ttcsid_C8BBG7RG5HF9JD2HL1I0=1749229908132::0eSb__dAGbHJwBwzwddX.178.1749231116833"; // Truncado

    const options = {
      headers: headers.set("Cookie", cookie), // ou use diretamente `.append()`,
      withCredentials: true, // Isto é o importante!
    };

    return this.http.get(`${this.baseUrl}${id}/1`, options);
  }
}
