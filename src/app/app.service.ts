import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AppService {
  baseUrl = 'https://gamersclub.com.br/lobby/match/'

  constructor(private http: HttpClient) { }


  searchPartida(id: any): Observable<any> {
   return  this.http.get(`${this.baseUrl}${id}/1`)
  }
}
