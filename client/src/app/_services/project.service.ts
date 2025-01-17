
import { Injectable, Output, EventEmitter } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import { Hmi, View, LayoutSettings } from '../_models/hmi';
import { Chart } from '../_models/chart';
import { Device, DeviceType, DeviceNetProperty } from '../_models/device';
import { EndPointApi } from '../_helpers/endpointapi';
import { ToastrService } from 'ngx-toastr';
import { TranslateService } from '@ngx-translate/core';

import * as FileSaver from 'file-saver';

@Injectable()
export class ProjectService {

    @Output() onSaveCurrent: EventEmitter<boolean> = new EventEmitter();
    @Output() onLoadHmi: EventEmitter<boolean> = new EventEmitter();

    private projectData = new ProjectData();            // Project data

    public version = '1.00';
    public separator = '^~^';
    public serverSettings: any;

    private prjresource = 'prj-data';
    private endPointConfig: string = EndPointApi.getURL(); //"http://localhost:1881";
    private projectOld: string = '';
    private saveworking = false;
    private ready = false;

    constructor(private http: HttpClient,
        private translateService: TranslateService,
        private toastr: ToastrService) {

        if (environment.serverEnabled) {
            this.checkServer().subscribe(result => {
                this.serverSettings = result;
                this.load();
            }, error => {
                console.error('project.service err: ' + error);
                this.load();
                this.notifySaveError();
            });
        } else {
            this.load();
        }
    }

    /**
     * Load Project from Server if enable.
     * From Local Storage, from 'assets' if demo or create a local project
     */
    private load() {
        if (this.serverSettings) {
            this.getServerProject().subscribe(prj => {
                this.projectData = prj;
                // copy to check before save
                this.projectOld = JSON.parse(JSON.stringify(this.projectData));
                this.ready = true;
                this.notifyToLoadHmi();
                console.log('Load Server Project: ' + prj);
            }, err => {
                console.log('Load Server Project err: ' + err);
            });
        } else {
            if (!this.projectData) {
                let res = localStorage.getItem(this.prjresource);
                if (res) {
                    console.log('Load Local Project');
                    this.projectData = JSON.parse(res);
                } else if (environment.type === 'demo') {
                    console.log('Load Demo Project');
                    // try root path
                    this.http.get<any>('./assets/project.demo.fuxap').subscribe(
                        prj => {
                            this.projectData = prj;
                        }, err => {
                        });
                } else {
                    console.log('Create Local Project');
                    this.setNewProject();
                }
            }
            this.ready = true;
        }
    }


    private save(): boolean {
        console.log('-save-');
        // this.projectData.version = this.version;
        // let prjData = this.convertToSave(this.projectData);
        if (this.serverSettings) {
            // check project change don't work some svg object change the order and this to check ...boooo
            this.setServerProject(this.projectData).subscribe(result => {
                this.load();
                // this.projectOld = JSON.parse(JSON.stringify(this.projectData));
                // console.log(result);
                // this.checSaveWorking(false);
                this.toastr.success('Project save successful!');
            }, err => {
                console.log(err);
                // this.checSaveWorking(false);
                var msg = '';
                this.translateService.get('msg.project-save-error').subscribe((txt: string) => { msg = txt });
                this.toastr.error(msg, '', {
                    timeOut: 3000,
                    closeButton: true,
                    disableTimeOut: true
                });
            });
        } else {
            localStorage.setItem(this.prjresource, JSON.stringify(this.projectData));
        }
        return true;
    }

    saveAs() {
        let filename = 'MyProject.fuxap';
        let date = new Date();
        let content = JSON.stringify(this.convertToSave(this.getProject()));
        let blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        FileSaver.saveAs(blob, filename);
    }

    /**
     * Remove Tag value to save without value
     * Value was added by HmiService from socketIo event
     * @param prj
     */
    private convertToSave(prj: ProjectData) {
        let result = JSON.parse(JSON.stringify(prj));
        for (let devid in result.devices) {
            for (let tagid in result.devices[devid].tags) {
                delete result.devices[devid].tags[tagid].value;
            }
            // Object.values(result.devices[devid].tags).forEach(tag => {
            // delete tag.value;

            // if (val[domViewId]) {
            //   delete val[domViewId];
            // }
            // });
            // for (let tag in Object.values(result.devices[devid].tags)) {
            // delete tag.value;
            // };
        }
        return result;
    }

    private notifySaveError() {
        let msg = '';
        this.translateService.get('msg.project-save-error').subscribe((txt: string) => { msg = txt });
        this.toastr.error(msg, '', {
            timeOut: 3000,
            closeButton: true,
            disableTimeOut: true
        });
    }

    // private checSaveWorking(check: boolean) {
    //     if (check && this.saveworking) {
    //         return false;
    //     }
    //     this.saveworking = check;
    //     return true;
    // }

    //#region Device to Save
    /**
     * Add or update Device to Project.
     * Save to Server
     * @param device
     * @param old
     */
    setDevice(device: Device, old: Device) {
        this.projectData.devices[device.name] = device;
        this.setServerProjectData(ProjectDataCmdType.SetDevice, device).subscribe(result => {
            if (old && old.name && old.name !== device.name && old.id === device.id) {
                this.removeDevice(old);
            }
        }, err => {
            console.log(err);
            this.notifySaveError();
        });
    }

    /**
     * Remove Device from Project.
     * Save to Server
     * @param device
     */
    removeDevice(device: Device) {
        delete this.projectData.devices[device.name];
        // Object.keys(this.projectData.devices).forEach((key) => {
        //     if (this.projectData.devices[key].id === device.id) {
        //         delete this.projectData.devices[key];
        //         return;
        //     }
        // });
        this.setServerProjectData(ProjectDataCmdType.DelDevice, device).subscribe(result => {
        }, err => {
            console.log(err);
            this.notifySaveError();
        });
    }
    //#endregion

    //#region View to Save
    /**
     * Add or update View to Project.
     * Save to Server
     * @param view
     */
    setView(view: View) {
        let v = null;
        for (let i = 0; i < this.projectData.hmi.views.length; i++) {
            if (this.projectData.hmi.views[i].id === view.id) {
                v = this.projectData.hmi.views[i];
            }
        }
        if (v) {
            v = view;
        } else {
            this.projectData.hmi.views.push(view);
        }
        this.setServerProjectData(ProjectDataCmdType.SetView, view).subscribe(result => {
        }, err => {
            console.log(err);
            this.notifySaveError();
        });
    }

    /**
     * Remove the View from Project
     * Delete from Server
     * @param view
     */
    removeView(view: View) {
        for (let i = 0; i < this.projectData.hmi.views.length; i++) {
            if (this.projectData.hmi.views[i].id === view.id) {
                this.projectData.hmi.views.splice(i, 1);
                break;
            }
        }
        this.setServerProjectData(ProjectDataCmdType.DelView, view).subscribe(result => {
        }, err => {
            console.log(err);
            this.notifySaveError();
        });
    }
    //#endregion
    setLayout(layout: LayoutSettings) {
        this.projectData.hmi.layout = layout;
        this.setServerProjectData(ProjectDataCmdType.HmiLayout, layout).subscribe(result => {
        }, err => {
            console.log(err);
            this.notifySaveError();
        });
    }
    //#region HMI

    //#endregion

    //#region to server api
    getServerProject(): Observable<any> {
        return this.http.get<any>(this.endPointConfig + '/api/project', {});
    }

    setServerProject(prj: ProjectData) {
        // let header = new HttpHeaders();
        // header.append("Access-Control-Allow-Origin", "*");
        // header.append("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
        let header = new HttpHeaders({ 'Content-Type': 'application/json' });
        return this.http.post<ProjectData>(this.endPointConfig + '/api/project', prj, { headers: header });
    }

    setServerProjectData(cmd: ProjectDataCmdType, data: any) {
        let header = new HttpHeaders({ 'Content-Type': 'application/json' });
        let params = { cmd: cmd, data: data };
        return this.http.post<any>(this.endPointConfig + '/api/projectData', params, { headers: header });
    }
    //#endregion

    //#region hmi resource json struct
    /**
     * get hmi resource
     */
    getHmi() {
        return (this.ready && this.projectData) ? this.projectData.hmi : null;
    }
    // getHmi(): Observable<Hmi> {
    //     return new Observable((observer) => {
    //         const handler = (e) => observer.next(e);
    //         // return (this.projectData) ? this.projectData.hmi : null;
    //     });
    // }

    // /**
    //  * save hmi resource to project
    //  * @param hmi hmiresource to save
    //  */
    // setHmi(hmi: Hmi, notify?: boolean) {
    //     this.projectData.hmi = hmi;
    //     if (notify) {
    //         this.notifyToLoadHmi();
    //     }
    // }
    //#endregion

    //#region charts resource
    /**
     * get charts resource
     */
    getCharts() {
        return (this.projectData) ? (this.projectData.charts) ? this.projectData.charts : [] : null;
    }

    getChart(id: string) {
        for (let i = 0; i < this.projectData.charts.length; i++) {
            if (this.projectData.charts[i].id === id) {
                return this.projectData.charts[i];
            }
        }
    }

    /**
     * save the charts to project
     * @param charts
     */
    setCharts(charts: Chart[]) {
        this.projectData.charts = charts;
        this.setServerProjectData(ProjectDataCmdType.Charts, charts).subscribe(result => {
        }, err => {
            console.log(err);
            this.notifySaveError();
        });        
    }
    //#endregion

    //#region Notify

    notifyToLoadHmi() {
        this.onLoadHmi.emit(true);
    }
    //#endregion

    /**
     * Set Project data and save resource to backend
     * Used from open and upload JSON Project file
     * @param prj project data to save
     */
    setProject(prj: ProjectData, notify?: boolean) {
        // redefine variable list and device list throw views resurce used
        // prj.version = this.version;
        // hmi.views.forEach(view => {
        //     for (let key in view.items) {
        //         // variable
        //         if (view.items[key].property.variableSrc && view.items[key].property.variable) {
        //             let device = hmi.devices[view.items[key].property.variableSrc];
        //             if (!device) {
        //                 device = new Device();
        //                 device.name = view.items[key].property.variableSrc;
        //                 // search in project
        //                 if (devices) {
        //                     let prjdevice = devices[view.items[key].property.variableSrc];
        //                     if (prjdevice) {
        //                         device = JSON.parse(JSON.stringify(prjdevice));
        //                         device.tags = {};
        //                     }
        //                 }
        //                 hmi.devices[view.items[key].property.variableSrc] = device;
        //             }
        //             // let tag = 
        //         }
        //         // alarm
        //     }
        // });
        // console.log('set-prj: ' + JSON.stringify(prj));
        this.projectData = prj;
        this.save();
        // if (notify) {
            // this.notifyToLoadHmi();
        // }
    }

    setNewProject() {
        this.projectData = new ProjectData();
        let server = new Device();
        server.name = 'Fuxa Server';
        server.id = '0';
        server.type = DeviceType.FuxaServer;
        server.property = new DeviceNetProperty();
        this.projectData.server = server;
        this.save();
        // this.setServer(server);
        // this.setServerProject(this.projectData).subscribe(result => {
        //     this.load();
        //     // this.projectOld = JSON.parse(JSON.stringify(this.projectData));
        //     // console.log(result);
        //     // this.checSaveWorking(false);
        //     this.toastr.success('Project save successful!');
        // }, err => {
        //     console.log(err);
        //     // this.checSaveWorking(false);
        //     var msg = '';
        //     this.translateService.get('msg.project-save-error').subscribe((txt: string) => { msg = txt });
        //     this.toastr.error(msg, '', {
        //         timeOut: 3000,
        //         closeButton: true,
        //         disableTimeOut: true
        //     });
        // });
        // this.notifyToLoadHmi();
    }

    getProject() {
        return this.projectData;
    }

    getServer(): Device {
        return (this.projectData) ? this.projectData.server : null;
    }

    // setServer(srv: Device, nosave?: boolean): boolean {
    //     this.projectData.server = srv;
    //     if (nosave) {
    //         return true;
    //     }
    //     return this.save();
    // }

    getDevices(): any {
        return (this.projectData) ? this.projectData.devices : {};
    }

    getDeviceFromId(id: string): any {
        let result;
        Object.keys(this.projectData.devices).forEach(k => {
            if (this.projectData.devices[k].id === id) {
                result = this.projectData.devices[k];
            }
        });
        return result;
    }

    setDevices(devices: any, nosave?: boolean): boolean {
        this.projectData.devices = devices;
        if (nosave) {
            return true;
        }
        return this.save();
    }

    addDevice(d: Device): boolean {
        let dev = this.projectData.devices[d.name];
        if (dev) {
            this.projectData.devices[d.name];
            return this.save();
        }
        return false;
    }

    /**
     * Send Save Project to to editor component
     * @param saveas 
     */
    saveProject(saveas?: boolean) {
        this.onSaveCurrent.emit(saveas);
    }

    checkServer() {
        return this.http.get<any>(this.endPointConfig + '/api/settings');
    }

    getDemoProject() {
        return this.http.get<any>(this.endPointConfig + '/api/projectdemo');
    }

    _deepEquals(x, y) {
        if (JSON.stringify(x) === JSON.stringify(y)) {
            return true; // if both x and y are null or undefined and exactly the same

        } else {
            try {
                for (const p in x) {
                    console.log(p);
                    if (!x.hasOwnProperty(p)) {
                        continue; // other properties were tested using x.constructor === y.constructor
                    }
                    if (!y.hasOwnProperty(p)) {
                        return false; // allows to compare x[ p ] and y[ p ] when set to undefined
                    }
                    if (p === 'svgcontent') {
                        // the xml have to be transform in json
                        const parser = new DOMParser();  // initialize dom parser
                        const aDOM = parser.parseFromString(x[p], "text/xml")
                        const bDOM = parser.parseFromString(y[p], "text/xml")
                        let a = this._xml2json(aDOM);
                        let b = this._xml2json(bDOM);
                        return this._deepEquals(a, b);
                    }
                    if (x[p] === y[p]) {
                        continue; // if they have the same strict value or identity then they are equal
                    }
                    if (!this._deepEquals(x[p], y[p])) {
                        return false;
                    }
                }
                for (const p in y) {
                    if (y.hasOwnProperty(p) && !x.hasOwnProperty(p)) {
                        return false;
                    }
                }
            } catch (ex) {
                console.log(ex);
                return false;
            }
            return true;
        }
    }

    /**
     * This function coverts a DOM Tree into JavaScript Object. 
     * @param srcDOM: DOM Tree to be converted. 
     */
    _xml2json(xml) {
        // Create the return object
        var obj = {};

        if (xml.nodeType == 1) { // element
            // do attributes
            if (xml.attributes.length > 0) {
                obj["@attributes"] = {};
                for (var j = 0; j < xml.attributes.length; j++) {
                    var attribute = xml.attributes.item(j);
                    obj["@attributes"][attribute.nodeName] = attribute.nodeValue;
                }
            }
        } else if (xml.nodeType == 3) { // text
            obj = xml.nodeValue;
        }

        // do children
        if (xml.hasChildNodes()) {
            for (var i = 0; i < xml.childNodes.length; i++) {
                var item = xml.childNodes.item(i);
                var nodeName = item.nodeName;
                if (typeof (obj[nodeName]) == "undefined") {
                    obj[nodeName] = this._xml2json(item);
                } else {
                    if (typeof (obj[nodeName].push) == "undefined") {
                        var old = obj[nodeName];
                        obj[nodeName] = [];
                        obj[nodeName].push(old);
                    }
                    obj[nodeName].push(this._xml2json(item));
                }
            }
        }
        return obj;
    }
}

export class ProjectData {
    version: string = "1.00"
    server: Device = new Device();
    hmi: Hmi = new Hmi();
    devices = {};
    charts: Chart[] = [];
}

export enum ProjectDataCmdType {
    SetDevice = 'set-device',
    DelDevice = 'del-device',
    SetView = 'set-view',
    DelView = 'del-view',
    HmiLayout = 'layout',
    Charts = 'charts',
}